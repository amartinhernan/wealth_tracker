# Usar una imagen base de Python oficial
FROM python:3.10-slim

# Evitar que Python genere archivos .pyc y activar el log instantáneo
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Establecer el directorio de trabajo
WORKDIR /app

# Instalar dependencias del sistema necesarias (opcional)
# RUN apt-get update && apt-get install -y --no-install-recommends gcc python3-dev && rm -rf /var/lib/apt/lists/*

# Copiar el archivo de dependencias e instalarlas
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el resto del código de la aplicación
COPY . .

# Cloud Run escucha en el puerto definido por la variable de entorno PORT (por defecto 8080)
ENV PORT 8080

# Comando para ejecutar la aplicación usando Gunicorn
# 'run:app' asume que en run.py tienes un objeto 'app' definido o que importas la app de flask
# Usamos 1 worker y 8 hilos para el nivel gratuito de Cloud Run
CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 0 run:app
