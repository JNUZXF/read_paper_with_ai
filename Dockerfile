FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_PORT=43117 \
    APP_RELOAD=false

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements.txt

COPY app /app/app
COPY web /app/web
COPY openrouter模型.md /app/openrouter模型.md
COPY run_server.py /app/run_server.py

RUN mkdir -p /app/data

EXPOSE 43117

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD python -c "import os,sys,urllib.request;port=os.getenv('APP_PORT','43117');u=f'http://127.0.0.1:{port}/health';sys.exit(0 if urllib.request.urlopen(u,timeout=3).status==200 else 1)"

CMD ["python", "run_server.py"]
