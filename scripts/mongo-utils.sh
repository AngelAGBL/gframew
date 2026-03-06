#!/bin/bash

# Utilidades para gestionar MongoDB en el proyecto Gemini

case "$1" in
  backup)
    echo "📦 Creando backup de comentarios..."
    docker exec gemini-mongo mongodump --db gemini_comments --out /backup
    docker cp gemini-mongo:/backup ./backup
    echo "✓ Backup guardado en ./backup"
    ;;
    
  restore)
    if [ -z "$2" ]; then
      echo "❌ Uso: $0 restore <ruta_backup>"
      exit 1
    fi
    echo "📥 Restaurando comentarios desde $2..."
    docker cp "$2" gemini-mongo:/backup
    docker exec gemini-mongo mongorestore --db gemini_comments /backup/gemini_comments
    echo "✓ Comentarios restaurados"
    ;;
    
  shell)
    echo "🐚 Abriendo shell de MongoDB..."
    docker exec -it gemini-mongo mongosh gemini_comments
    ;;
    
  stats)
    echo "📊 Estadísticas de comentarios..."
    docker exec gemini-mongo mongosh gemini_comments --quiet --eval "
      print('Total de comentarios: ' + db.comments.countDocuments());
      print('\\nComentarios por archivo:');
      db.comments.aggregate([
        { \$group: { _id: '\$filePath', count: { \$sum: 1 } } },
        { \$sort: { count: -1 } }
      ]).forEach(doc => print('  ' + doc._id + ': ' + doc.count));
    "
    ;;
    
  clean)
    read -p "⚠️  ¿Estás seguro de eliminar TODOS los comentarios? (y/N): " confirm
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
      echo "🗑️  Eliminando todos los comentarios..."
      docker exec gemini-mongo mongosh gemini_comments --quiet --eval "db.comments.deleteMany({})"
      echo "✓ Comentarios eliminados"
    else
      echo "Operación cancelada"
    fi
    ;;
    
  *)
    echo "Utilidades MongoDB para Gemini Server"
    echo ""
    echo "Uso: $0 {backup|restore|shell|stats|clean}"
    echo ""
    echo "Comandos:"
    echo "  backup          - Crear backup de comentarios"
    echo "  restore <path>  - Restaurar comentarios desde backup"
    echo "  shell           - Abrir shell de MongoDB"
    echo "  stats           - Mostrar estadísticas de comentarios"
    echo "  clean           - Eliminar todos los comentarios"
    exit 1
    ;;
esac
