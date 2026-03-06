import { MongoClient, Db, Collection } from 'mongodb';
import logger from './logger.ts';

export interface Comment {
  username: string;
  comment: string;
  timestamp: Date;
  filePath: string;
}

class Database {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private commentsCollection: Collection<Comment> | null = null;

  async connect(): Promise<void> {
    const mongoUrl = process.env.MONGO_URL || 'mongodb://mongo:27017';
    const dbName = process.env.MONGO_DB || 'gemini_comments';

    try {
      this.client = new MongoClient(mongoUrl);
      await this.client.connect();
      this.db = this.client.db(dbName);
      this.commentsCollection = this.db.collection<Comment>('comments');
      
      // Create index for faster queries
      await this.commentsCollection.createIndex({ filePath: 1, timestamp: -1 });
      
      logger.info(`✓ Connected to MongoDB: ${dbName}`);
    } catch (error) {
      logger.error(`Failed to connect to MongoDB: ${error}`);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      logger.info('Disconnected from MongoDB');
    }
  }

  getCommentsCollection(): Collection<Comment> {
    if (!this.commentsCollection) {
      throw new Error('Database not connected');
    }
    return this.commentsCollection;
  }

  isConnected(): boolean {
    return this.client !== null && this.db !== null;
  }
}

export const database = new Database();
