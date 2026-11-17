# Importing the Celery app here (not just in celery.py) ensures it's
# loaded whenever Django starts, so @shared_task-decorated tasks always
# bind to this app instance.
from .celery import app as celery_app

__all__ = ('celery_app',)
