// MongoDB connection, reused across requests (and across warm serverless invocations).
import { MongoClient } from 'mongodb';

let pending = null;

export function registrations() {
  if (!pending) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set');
    pending = (async () => {
      const client = new MongoClient(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 8000 });
      await client.connect();
      const col = client.db(process.env.MONGODB_DB || 'iicm').collection('registrations');
      await col.createIndex({ email: 1 }, { unique: true });
      await col.createIndex({ 'mail.status': 1 });
      return { client, col };
    })().catch(err => { pending = null; throw err; });
  }
  return pending.then(x => x.col);
}

export async function closeDb() {
  if (!pending) return;
  const { client } = await pending.catch(() => ({}));
  pending = null;
  if (client) await client.close();
}
