import { database, type Comment } from '../config/database.ts';
import logger from '../config/logger.ts';

export async function getComments(filePath: string): Promise<Comment[]> {
  try {
    const collection = database.getCommentsCollection();
    return await collection
      .find({ filePath })
      .sort({ timestamp: 1 })
      .toArray();
  } catch (error) {
    logger.error(`Error fetching comments for ${filePath}: ${error}`);
    return [];
  }
}

export async function addComment(
  filePath: string,
  username: string,
  comment: string
): Promise<boolean> {
  try {
    const collection = database.getCommentsCollection();
    await collection.insertOne({
      filePath,
      username,
      comment,
      timestamp: new Date()
    });
    logger.info(`Comment added for ${filePath} by ${username}`);
    return true;
  } catch (error) {
    logger.error(`Error adding comment: ${error}`);
    return false;
  }
}

export function formatComments(comments: Comment[]): string {
  if (!comments || comments.length === 0) {
    return '## Comentarios\n=> ?input Escribe tu comentario\nNo hay comentarios aún.\n';
  }
  
  const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };
  
  let result = '## Comentarios\n\n=> ?input Escribe tu comentario';
  for (const comment of comments) {
    const date = formatDate(comment.timestamp);
    result += `\n### 👤 ${comment.username} - ${date}\n`;
    result += `${comment.comment}\n`;
  }
  result += '\n=> ?input Escribe tu comentario\n';
  return result;
}
