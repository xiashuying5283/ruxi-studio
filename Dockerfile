FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/data
WORKDIR /app
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock \
    && groupadd -g 10001 studio && useradd -u 10001 -g studio -M studio \
    && mkdir /data && chown studio:studio /data
COPY --chown=studio:studio server ./server
COPY --chown=studio:studio web ./web
USER studio
EXPOSE 8000
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "4", "--timeout", "180", "--access-logfile", "-", "server.wsgi:app"]
