"""Stripe payment processing and test-mode integration service for RankLens.

Handles Stripe customer creation, checkout session initialization, customer
portal access, and safe webhook processing in test mode (per MVP billing scope).
Falls back to deterministic local test-mode simulation if no live API keys are
supplied in the environment.
"""

import logging
import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Any

import stripe
from django.conf import settings
from django.utils import timezone

from .billing import get_or_create_current_billing_period
from .models import Agency, Subscription, SubscriptionPlan
from .tenancy import use_agency

logger = logging.getLogger(__name__)


def get_stripe_secret_key() -> str:
    """Returns the configured Stripe secret key from Django settings."""
    return getattr(settings, "STRIPE_SECRET_KEY", "") or ""


def is_stripe_configured() -> bool:
    """Returns True if a real or test Stripe secret key is present in settings."""
    key = get_stripe_secret_key()
    return bool(key and not key.startswith("placeholder") and len(key) > 8)


def get_stripe_publishable_key() -> str:
    """Returns the Stripe publishable key from settings."""
    return getattr(settings, "STRIPE_PUBLISHABLE_KEY", "") or "pk_test_placeholder"


def create_or_get_stripe_customer(agency: Agency, user_email: str | None = None, user_name: str | None = None) -> str:
    """Retrieves existing Stripe customer ID from agency subscription or creates a new
    customer in Stripe (test mode) and updates the subscription record."""
    subscription = getattr(agency, "subscription", None)
    if subscription and subscription.stripe_customer_id:
        return subscription.stripe_customer_id

    customer_id = f"cus_test_{uuid.uuid4().hex[:14]}"
    customer_email = user_email or (agency.users.first().email if agency.users.exists() else f"billing@{agency.subdomain or 'agency'}.com")
    customer_name = user_name or agency.name

    if is_stripe_configured():
        try:
            stripe.api_key = get_stripe_secret_key()
            customer = stripe.Customer.create(
                email=customer_email,
                name=customer_name,
                metadata={
                    "agency_id": str(agency.id),
                    "agency_name": agency.name,
                },
            )
            customer_id = customer.id
        except Exception as exc:
            logger.warning("Stripe Customer.create failed (using simulated test ID): %s", exc)

    if subscription:
        subscription.stripe_customer_id = customer_id
        subscription.save(update_fields=["stripe_customer_id"])

    return customer_id


def create_checkout_session(
    agency: Agency,
    user,
    plan: SubscriptionPlan,
    billing_interval: str,
    success_url: str | None = None,
    cancel_url: str | None = None,
) -> dict[str, Any]:
    """Creates a Stripe Checkout Session in subscription mode.
    Attaches agency, plan, and billing interval metadata for webhook fulfillment."""
    customer_id = create_or_get_stripe_customer(agency, user.email, user.get_full_name() if hasattr(user, "get_full_name") else user.email)
    
    frontend_base = getattr(settings, "FRONTEND_URL", "http://localhost:3000")
    success_url = success_url or f"{frontend_base}/billing?session_id={{CHECKOUT_SESSION_ID}}&status=success"
    cancel_url = cancel_url or f"{frontend_base}/billing?status=cancelled"

    unit_amount_usd = plan.yearly_price_usd if billing_interval == Subscription.BillingInterval.YEARLY else plan.monthly_price_usd
    unit_amount_cents = int(Decimal(str(unit_amount_usd)) * 100)

    metadata = {
        "agency_id": str(agency.id),
        "plan_id": str(plan.id),
        "plan_slug": plan.slug,
        "billing_interval": billing_interval,
        "user_id": str(user.id),
    }

    if is_stripe_configured():
        try:
            stripe.api_key = get_stripe_secret_key()
            session = stripe.checkout.Session.create(
                customer=customer_id,
                payment_method_types=["card"],
                line_items=[
                    {
                        "price_data": {
                            "currency": "usd",
                            "product_data": {
                                "name": f"RankLens {plan.name} Plan ({billing_interval.capitalize()})",
                                "description": f"{plan.prompt_runs_included} included prompt runs/period, {plan.client_limit} clients, {plan.stored_prompt_limit} prompts.",
                            },
                            "unit_amount": unit_amount_cents,
                            "recurring": {
                                "interval": "year" if billing_interval == Subscription.BillingInterval.YEARLY else "month",
                            },
                        },
                        "quantity": 1,
                    }
                ],
                mode="subscription",
                metadata=metadata,
                success_url=success_url,
                cancel_url=cancel_url,
            )
            return {
                "checkout_url": session.url,
                "session_id": session.id,
                "mode": "live_stripe",
                "customer_id": customer_id,
            }
        except Exception as exc:
            logger.warning("Stripe Checkout.Session.create failed (falling back to test simulator): %s", exc)

    # Deterministic Test Mode Simulator
    mock_session_id = f"cs_test_{uuid.uuid4().hex[:18]}"
    mock_checkout_url = f"{frontend_base}/checkout?session_id={mock_session_id}&plan={plan.slug}&interval={billing_interval}"
    return {
        "checkout_url": mock_checkout_url,
        "session_id": mock_session_id,
        "mode": "test_simulator",
        "customer_id": customer_id,
        "metadata": metadata,
    }


def create_customer_portal_session(agency: Agency, return_url: str | None = None) -> dict[str, Any]:
    """Creates a Stripe Billing Customer Portal session so the agency can
    update payment methods and view Stripe invoices."""
    customer_id = create_or_get_stripe_customer(agency)
    frontend_base = getattr(settings, "FRONTEND_URL", "http://localhost:3000")
    return_url = return_url or f"{frontend_base}/billing"

    if is_stripe_configured():
        try:
            stripe.api_key = get_stripe_secret_key()
            portal_session = stripe.billing_portal.Session.create(
                customer=customer_id,
                return_url=return_url,
            )
            return {"portal_url": portal_session.url}
        except Exception as exc:
            logger.warning("Stripe billing_portal.Session.create failed: %s", exc)

    return {"portal_url": f"{frontend_base}/billing?portal=simulated"}


def fulfill_checkout_session(session_data: dict[str, Any]) -> Subscription | None:
    """Fulfills a completed Stripe Checkout session by provisioning or updating
    the agency's subscription, activating the period, and snapshotting usage."""
    metadata = session_data.get("metadata") or {}
    agency_id = metadata.get("agency_id")
    plan_slug = metadata.get("plan_slug")
    billing_interval = metadata.get("billing_interval", Subscription.BillingInterval.MONTHLY)

    if not agency_id:
        logger.error("Checkout session fulfillment missing agency_id in metadata: %s", session_data)
        return None

    try:
        agency = Agency.objects.get(id=agency_id)
    except Agency.DoesNotExist:
        logger.error("Agency %s not found for checkout fulfillment", agency_id)
        return None

    plan = SubscriptionPlan.objects.filter(slug=plan_slug, is_active=True).first()
    if not plan:
        plan = SubscriptionPlan.objects.filter(is_active=True).first()

    if not plan:
        logger.error("No active SubscriptionPlan found to fulfill checkout")
        return None

    customer_id = session_data.get("customer") or session_data.get("customer_id")
    subscription_id = session_data.get("subscription")

    with use_agency(bypass=True):
        subscription = getattr(agency, "subscription", None)
        today = timezone.now().date()
        period_days = 365 if billing_interval == Subscription.BillingInterval.YEARLY else 30

        if subscription is None:
            subscription = Subscription.objects.create(
                agency=agency,
                plan=plan,
                billing_interval=billing_interval,
                status=Subscription.Status.ACTIVE,
                current_period_start=today,
                current_period_end=today + timedelta(days=period_days),
                stripe_customer_id=customer_id,
                stripe_subscription_id=subscription_id,
            )
        else:
            subscription.plan = plan
            subscription.billing_interval = billing_interval
            subscription.status = Subscription.Status.ACTIVE
            subscription.current_period_start = today
            subscription.current_period_end = today + timedelta(days=period_days)
            if customer_id:
                subscription.stripe_customer_id = customer_id
            if subscription_id:
                subscription.stripe_subscription_id = subscription_id
            subscription.save(update_fields=[
                "plan",
                "billing_interval",
                "status",
                "current_period_start",
                "current_period_end",
                "stripe_customer_id",
                "stripe_subscription_id",
            ])

        # Provision and snapshot active billing period usage
        period = get_or_create_current_billing_period(subscription)
        if period:
            period.plan = plan
            period.billing_interval = billing_interval
            period.base_prompt_run_allowance = plan.prompt_runs_included
            period.save(update_fields=["plan", "billing_interval", "base_prompt_run_allowance"])

        logger.info("Successfully fulfilled subscription for agency %s (Plan: %s)", agency.name, plan.name)
        return subscription


def handle_stripe_webhook_event(payload: bytes, sig_header: str | None = None) -> dict[str, Any]:
    """Safely verifies and processes incoming Stripe webhook events."""
    endpoint_secret = getattr(settings, "STRIPE_WEBHOOK_SECRET", None)

    # Every event must carry a valid Stripe signature. There is deliberately
    # no unsigned fallback: this endpoint is public, and an unverified
    # "checkout.session.completed" would let anyone activate a paid plan.
    if not (is_stripe_configured() and endpoint_secret):
        raise ValueError("Stripe webhooks are not configured on this server.")
    if not sig_header:
        raise ValueError("Missing Stripe-Signature header.")
    try:
        stripe.api_key = get_stripe_secret_key()
        event = stripe.Webhook.construct_event(payload, sig_header, endpoint_secret)
    except Exception as exc:
        logger.warning("Stripe webhook signature verification failed: %s", exc)
        raise ValueError("Invalid webhook signature.") from exc

    event_type = event.get("type")
    data_object = event.get("data", {}).get("object", {})

    logger.info("Processing Stripe webhook event: %s", event_type)

    if event_type == "checkout.session.completed":
        subscription = fulfill_checkout_session(data_object)
        return {"handled": True, "event": event_type, "subscription_id": str(subscription.id) if subscription else None}

    elif event_type in ("customer.subscription.updated", "customer.subscription.created"):
        stripe_sub_id = data_object.get("id")
        stripe_status = data_object.get("status")
        if stripe_sub_id:
            sub = Subscription.objects.filter(stripe_subscription_id=stripe_sub_id).first()
            if sub:
                if stripe_status == "active":
                    sub.status = Subscription.Status.ACTIVE
                elif stripe_status in ("past_due", "unpaid"):
                    sub.status = Subscription.Status.PAST_DUE
                elif stripe_status == "canceled":
                    sub.status = Subscription.Status.CANCELLED
                sub.save(update_fields=["status"])
                return {"handled": True, "event": event_type, "status": sub.status}

    elif event_type == "customer.subscription.deleted":
        stripe_sub_id = data_object.get("id")
        if stripe_sub_id:
            sub = Subscription.objects.filter(stripe_subscription_id=stripe_sub_id).first()
            if sub:
                sub.status = Subscription.Status.CANCELLED
                sub.save(update_fields=["status"])
                return {"handled": True, "event": event_type, "status": "cancelled"}

    elif event_type == "invoice.payment_succeeded":
        customer_id = data_object.get("customer")
        if customer_id:
            sub = Subscription.objects.filter(stripe_customer_id=customer_id).first()
            if sub and sub.status != Subscription.Status.ACTIVE:
                sub.status = Subscription.Status.ACTIVE
                sub.save(update_fields=["status"])
                return {"handled": True, "event": event_type, "reactivated": True}

    elif event_type == "invoice.payment_failed":
        customer_id = data_object.get("customer")
        if customer_id:
            sub = Subscription.objects.filter(stripe_customer_id=customer_id).first()
            if sub:
                sub.status = Subscription.Status.PAST_DUE
                sub.save(update_fields=["status"])
                return {"handled": True, "event": event_type, "marked_past_due": True}

    return {"handled": False, "event": event_type}
