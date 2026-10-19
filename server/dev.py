"""Local loopback preview only. Production uses Gunicorn."""
import os
from .app import create_app
app = create_app()
if __name__ == '__main__':
    app.run(host='127.0.0.1', port=int(os.getenv('PORT', '8766')), threaded=True)
