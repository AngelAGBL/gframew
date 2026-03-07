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
    const day = String(date.getDate()).padStart(2, '0');
    const month = date.toLocaleString('en-US', { month: 'long' }).toLowerCase();
    const year = date.getFullYear();
    const time = date.toLocaleString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: true 
    });
    return `📅 ${day} ${month} ${year} - ⏰ ${time}`;
  };
  
  let result = '';
  for (const comment of comments) {
    const date = formatDate(comment.timestamp);
    result += `\n👤 ${comment.username} - ${date}\n`;
    result += `> ${comment.comment}\n`;
  }
  return result;
}
