# Sistema de Comentarios con MongoDB

## Funcionalidad implementada

El sistema de comentarios permite a los usuarios con certificados de cliente dejar comentarios en archivos `.gmi` que contengan la tag `{{comments}}`. Los comentarios se almacenan en MongoDB.

## Arquitectura

- **Base de datos**: MongoDB 7
- **Colección**: `comments` en la base de datos `gemini_comments`
- **Índice**: `filePath` + `timestamp` para consultas rápidas
- **Contenerización**: Docker Compose con servicios separados

## Cómo funciona

### 1. Archivo con comentarios

Para habilitar comentarios en un archivo `.gmi`, simplemente incluye la tag de Handlebars:

```
{{comments}}
```

### 2. Flujo de comentarios

- **Ver comentarios**: Al acceder a `archivo.gmi`, se muestran todos los comentarios guardados
- **Formulario de comentario**: Al acceder a `archivo.gmi?comment`:
  - Sin certificado: devuelve `60 Certificate needed`
  - Con certificado: devuelve `10 Escribe tu comentario`
- **Enviar comentario**: Al acceder a `archivo.gmi?mi_comentario_aqui`:
  - Sin certificado: devuelve `60 Certificate needed`
  - Con certificado: guarda el comentario y redirige con `30 archivo.gmi`

### 3. Almacenamiento en MongoDB

Los comentarios se guardan en MongoDB con la siguiente estructura:

```javascript
{
  _id: ObjectId("..."),
  filePath: "ruta/archivo.gmi",
  username: "nombre_del_certificado",
  comment: "texto del comentario",
  timestamp: ISODate("2026-03-05T...")
}
```

### 4. Formato de visualización

Los comentarios se muestran en formato Gemini:

```
## Comentarios

### usuario1 - 2026-03-05T10:30:00.000Z
Este es un comentario de ejemplo

### usuario2 - 2026-03-05T11:45:00.000Z
Otro comentario
```

## Instalación y Despliegue

### Con Docker Compose (Recomendado)

1. Construir y levantar los servicios:

```bash
docker compose up -d
```

Esto levantará:
- MongoDB en el puerto interno 27017
- Servidor Gemini en el puerto 1965

2. Ver logs:

```bash
docker compose logs -f
```

3. Detener los servicios:

```bash
docker compose down
```

4. Detener y eliminar volúmenes (borra los comentarios):

```bash
docker compose down -v
```

### Desarrollo Local

1. Instalar dependencias:

```bash
bun install
```

2. Levantar MongoDB:

```bash
docker run -d -p 27017:27017 --name mongo mongo:7
```

3. Configurar variables de entorno:

```bash
export MONGO_URL=mongodb://localhost:27017
export MONGO_DB=gemini_comments
```

4. Ejecutar el servidor:

```bash
bun run dev
```

## Configuración

### Variables de Entorno

- `MONGO_URL`: URL de conexión a MongoDB (default: `mongodb://mongo:27017`)
- `MONGO_DB`: Nombre de la base de datos (default: `gemini_comments`)

### Estructura de Docker Compose

```yaml
services:
  mongo:
    - Base de datos MongoDB
    - Volumen persistente para datos
    
  gemfw:
    - Servidor Gemini
    - Conectado a MongoDB
    - Puerto 1965 expuesto
```

## Ejemplo de uso

Ver el archivo `public/ejemplo-comentarios.gmi` para un ejemplo completo.

## Seguridad

- Solo usuarios con certificados de cliente válidos pueden comentar
- Los comentarios se identifican por el CN del certificado o su fingerprint
- Las URLs se decodifican automáticamente para manejar caracteres especiales
- Conexión segura entre servicios mediante red Docker privada

## Mantenimiento

### Backup de comentarios

```bash
docker exec gemini-mongo mongodump --db gemini_comments --out /backup
docker cp gemini-mongo:/backup ./backup
```

### Restaurar comentarios

```bash
docker cp ./backup gemini-mongo:/backup
docker exec gemini-mongo mongorestore --db gemini_comments /backup/gemini_comments
```

### Acceder a MongoDB

```bash
docker exec -it gemini-mongo mongosh gemini_comments
```

Consultas útiles:

```javascript
// Ver todos los comentarios
db.comments.find()

// Comentarios de un archivo específico
db.comments.find({ filePath: "ejemplo-comentarios.gmi" })

// Contar comentarios por archivo
db.comments.aggregate([
  { $group: { _id: "$filePath", count: { $sum: 1 } } }
])
```

