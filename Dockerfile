FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip

COPY bot/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --default-timeout=100 --retries 5 -r requirements.txt

COPY bot/ .
COPY scripts/ scripts/
COPY data/ data/

CMD ["python", "bot.py"]
