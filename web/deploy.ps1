# Script de despliegue para Wealth Tracker en Cloud Run (Windows PowerShell)

$PROJECT_ID = "wealthtracker-d2a0d"
$SERVICE_NAME = "wealth-tracker"
$REGION = "europe-west1" # Puedes cambiar esto (us-central1, europe-southwest1, etc.)

Write-Host "--- INICIANDO DESPLIEGUE EN CLOUD RUN ---" -ForegroundColor Cyan

# 1. Asegurarse de que el proyecto correcto está seleccionado
Write-Host "> Configurando proyecto: $PROJECT_ID..."
gcloud config set project $PROJECT_ID

# 2. Desplegar directamente desde el código fuente (GCP compilará la imagen por ti)
Write-Host "> Compilando y desplegando servicio..."
gcloud run deploy $SERVICE_NAME `
    --source . `
    --region $REGION `
    --allow-unauthenticated `
    --platform managed `
    --max-instances 1

Write-Host "--- DESPLIEGUE COMPLETADO ---" -ForegroundColor Green
Write-Host "Copia la URL de arriba para acceder a tu aplicación desde cualquier sitio."
