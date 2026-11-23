import { MongoClient, Db, ObjectId } from "mongodb";

const g = globalThis as unknown as { _fixmateDb?: Promise<Db> };

async function connect(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.DB_NAME || "fixmate");

  await db.collection("payments").createIndex({ stripeSessionId: 1 }, { unique: true });
  await db.collection("services").createIndex({ approvalStatus: 1, isAvailable: 1, createdAt: -1 });
  await db.collection("bookings").createIndex({ customerEmail: 1 });
  await db.collection("bookings").createIndex({ technicianEmail: 1 });
  return db;
}


export function getDb(): Promise<Db> {
  if (!g._fixmateDb) g._fixmateDb = connect();
  return g._fixmateDb;
}

export async function cols() {
  const db = await getDb();
  return {

    users: db.collection("user"),
    services: db.collection("services"),
    bookings: db.collection("bookings"),
    payments: db.collection("payments"),
  };
}

export function toObjectId(id: string): ObjectId | null {
  return ObjectId.isValid(id) && String(new ObjectId(id)) === id ? new ObjectId(id) : null;
}
