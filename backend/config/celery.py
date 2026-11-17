import os

from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

app = Celery('avtr')

# Reads every CELERY_* setting from config/settings.py (namespace='CELERY'
# means the CELERY_ prefix is stripped, e.g. CELERY_BROKER_URL -> broker_url).
app.config_from_object('django.conf:settings', namespace='CELERY')

# Pulls in tasks.py from every installed app (just core/tasks.py for now)
# instead of importing task modules by hand one at a time.
app.autodiscover_tasks()
