# Guía de Despliegue

## Despliegue Rápido

### 1. Iniciar los servicios

```bash
docker compose up -d
```

Esto iniciará:
- MongoDB en el puerto interno 27017
- Servidor Gemini en el puerto 1965

### 2. Verificar que los servicios están corriendo

```bash
docker compose ps
```

Deberías ver:
```
NAME                IMAGE       STATUS
gemini-mongo        mongo:7     Up
gemini-server       gframew     Up
```

### 3. Ver los logs

```bash
# Todos los servicios
docker compose logs -f

# Solo el servidor Gemini
docker compose logs -f gemfw

# Solo MongoDB
docker compose logs -f mongo
```

### 4. Probar el servidor

Usa un cliente Gemini como:
- [Lagrange](https://github.com/skyjake/lagrange)
- [Amfora](https://github.com/makeworld-the-better-one/amfora)
- [Bombadillo](https://bombadillo.colorfield.space/)

Conecta a: `gemini://localhost:1965`

## Probar el Sistema de Comentarios

### 1. Generar un certificado de cliente

En Lagrange:
1. Ve a Settings → Identities
2. Crea una nueva identidad
3. Actívala para localhost

### 2. Acceder a la página de ejemplo

```
gemini://localhost:1965/ejemplo-comentarios.gmi
```

### 3. Escribir un comentario

1. Haz clic en el enlace "Escribir un comentario"
2. El servidor pedirá tu certificado (si no está activo)
3. Escribe tu comentario en el prompt
4. Serás redirigido a la página con tu comentario visible

## Comandos Útiles

### Reiniciar servicios

```bash
docker compose restart
```

### Reconstruir la imagen

```bash
docker compose build --no-cache
docker compose up -d
```

### Detener servicios

```bash
docker compose down
```

### Detener y eliminar datos (¡cuidado!)

```bash
docker compose down -v
```

### Ver estadísticas de comentarios

```bash
./scripts/mongo-utils.sh stats
```

### Backup de comentarios

```bash
./scripts/mongo-utils.sh backup
```

## Solución de Problemas

### El servidor no inicia

1. Verifica que el puerto 1965 no esté en uso:
```bash
sudo lsof -i :1965
```

2. Revisa los logs:
```bash
docker compose logs gemfw
```

### MongoDB no conecta

1. Verifica que MongoDB esté corriendo:
```bash
docker compose ps mongo
```

2. Revisa los logs de MongoDB:
```bash
docker compose logs mongo
```

3. Verifica la conectividad:
```bash
docker exec gemini-server ping mongo
```

### Los comentarios no se guardan

1. Verifica que tengas un certificado de cliente activo
2. Revisa los logs del servidor:
```bash
docker compose logs -f gemfw
```

3. Verifica la conexión a MongoDB:
```bash
docker exec gemini-mongo mongosh gemini_comments --eval "db.comments.countDocuments()"
```

### Permisos en el volumen public

Si tienes problemas con permisos:

```bash
sudo chown -R 1000:1000 ./public
```

## Despliegue en Producción

### 1. Configurar dominio y certificados

Edita el `Containerfile` para usar tu dominio:

```dockerfile
RUN openssl req -x509 -nodes -days 365 -keyout server.key -out server.crt \
  -newkey rsa:2048 -subj "/CN=tu-dominio.com" \
  -addext "subjectAltName = DNS:tu-dominio.com"
```

### 2. Configurar variables de entorno

Crea un archivo `.env`:

```bash
MONGO_URL=mongodb://mongo:27017
MONGO_DB=gemini_comments
```

### 3. Usar certificados reales

Reemplaza `server.key` y `server.crt` con tus certificados reales.

### 4. Configurar firewall

```bash
# UFW
sudo ufw allow 1965/tcp

# firewalld
sudo firewall-cmd --permanent --add-port=1965/tcp
sudo firewall-cmd --reload
```

### 5. Configurar backups automáticos

Crea un cron job:

```bash
# Editar crontab
crontab -e

# Agregar backup diario a las 3 AM
0 3 * * * /ruta/a/scripts/mongo-utils.sh backup
```

### 6. Monitoreo

Considera usar:
- [Portainer](https://www.portainer.io/) para gestión de contenedores
- [Prometheus](https://prometheus.io/) + [Grafana](https://grafana.com/) para métricas
- Logs centralizados con ELK stack

## Actualización

### 1. Detener servicios

```bash
docker compose down
```

### 2. Actualizar código

```bash
git pull
```

### 3. Reconstruir y reiniciar

```bash
docker compose build
docker compose up -d
```

### 4. Verificar

```bash
docker compose logs -f
```
