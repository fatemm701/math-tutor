FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DB_PATH=/data/math_tutor.db

RUN useradd -m -u 1000 appuser && mkdir -p /data && chown -R appuser:appuser /data

WORKDIR /app

# 优先利用层缓存安装依赖
COPY pyproject.toml ./
RUN pip install --no-cache-dir .

COPY app ./app
RUN chown -R appuser:appuser /app

USER appuser
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]