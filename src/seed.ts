
import "dotenv/config";
import { getDb, cols } from "./db";

const T1 = process.env.SEED_TECH1_EMAIL || "tech1@fixmate.dev";
const T2 = process.env.SEED_TECH2_EMAIL || "tech2@fixmate.dev";
const CUSTOMER = process.env.SEED_CUSTOMER_EMAIL || "customer@fixmate.dev";

const img = (label: string) =>
  `https://placehold.co/800x500/0f172a/f97316/png?text=${encodeURIComponent(label)}`;

type Seed = [string, string, string, number, string, "Home Visit" | "Shop Drop-off", string, 1 | 2];
const SERVICES: Seed[] = [
  ["iPhone Screen Replacement", "Smartphone", "Genuine-grade display replacement with 30-day warranty. Includes touch and Face ID calibration check.", 89, "2-3 hours", "Shop Drop-off", "Dhanmondi, Dhaka", 1],
  ["Android Battery Replacement", "Smartphone", "Swap a worn-out battery and restore full-day battery life. Free health test before and after.", 35, "1 hour", "Shop Drop-off", "Mirpur, Dhaka", 1],
  ["Laptop Deep Cleaning & Thermal Paste", "Laptop & PC", "Full internal dust cleaning, fan service and fresh thermal paste to stop overheating and throttling.", 45, "3-4 hours", "Shop Drop-off", "Dhanmondi, Dhaka", 1],
  ["Laptop SSD Upgrade & OS Install", "Laptop & PC", "Upgrade to an SSD, clone your data and install a clean OS with all drivers. Big speed boost.", 60, "1 day", "Shop Drop-off", "Uttara, Dhaka", 2],
  ["AC Servicing & Gas Check", "AC", "Indoor and outdoor unit wash, filter cleaning, drain check and gas pressure test for split ACs.", 40, "2 hours", "Home Visit", "Gulshan, Dhaka", 2],
  ["AC Installation (Split)", "AC", "Professional wall mounting, piping and vacuum test for split air conditioners, up to 2 tons.", 75, "4-5 hours", "Home Visit", "Banani, Dhaka", 2],
  ["Refrigerator Compressor Repair", "Refrigerator", "Diagnosis and repair of cooling failure, compressor start relay and thermostat problems.", 70, "1 day", "Home Visit", "Mirpur, Dhaka", 1],
  ["Fridge Gas Refill & Leak Fix", "Refrigerator", "Leak detection, brazing and gas refill so your fridge cools properly again.", 55, "3 hours", "Home Visit", "Mohammadpur, Dhaka", 1],
  ["LED TV Panel & Backlight Repair", "TV", "Backlight strip replacement and panel diagnostics for LED and LCD televisions.", 80, "1-2 days", "Shop Drop-off", "Uttara, Dhaka", 2],
  ["Smart TV Software & Wi-Fi Fix", "TV", "Fix boot loops, app crashes, remote pairing and Wi-Fi issues on all major smart TV brands.", 25, "1 hour", "Home Visit", "Gulshan, Dhaka", 2],
  ["Washing Machine Drum & Bearing Repair", "Washing Machine", "Replace worn bearings and seals to stop loud noise and leaks on front and top loaders.", 65, "1 day", "Home Visit", "Dhanmondi, Dhaka", 1],
  ["Washing Machine Not Draining Fix", "Washing Machine", "Clear blocked pumps and replace faulty drain motors. Same-day service in most cases.", 30, "2 hours", "Home Visit", "Mirpur, Dhaka", 1],
  ["Home Electrical Wiring Check", "Electrical", "Safety inspection of sockets, MCB and wiring, with fixes for short circuits and tripping breakers.", 38, "2-3 hours", "Home Visit", "Banani, Dhaka", 2],
  ["Ceiling Fan & Light Installation", "Electrical", "Neat installation and repair of ceiling fans, tube lights and decorative lighting.", 20, "1-2 hours", "Home Visit", "Uttara, Dhaka", 2],
];

async function main() {
  await getDb();
  const { users, services, bookings, payments } = await cols();

  const [t1, t2, customer] = await Promise.all([
    users.findOne({ email: T1 }),
    users.findOne({ email: T2 }),
    users.findOne({ email: CUSTOMER }),
  ]);
  if (!t1 || !t2 || !customer) {
    console.error(
      `Missing demo users. Run the client seed first so ${T1}, ${T2} and ${CUSTOMER} exist.`
    );
    process.exit(1);
  }

  await Promise.all([services.deleteMany({}), bookings.deleteMany({}), payments.deleteMany({})]);

  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const docs = SERVICES.map(([title, category, description, basePrice, estimatedDuration, serviceMode, serviceArea, who], i) => {
    const tech = who === 1 ? t1 : t2;
    return {
      title,
      category,
      description,
      image: img(title),
      basePrice,
      estimatedDuration,
      serviceMode,
      serviceArea,
      technicianName: tech.name,
      technicianEmail: tech.email,
      approvalStatus: "approved",
      isAvailable: true,
      createdAt: new Date(now - (SERVICES.length - i) * day),
    };
  });

  docs.push({
    ...docs[0],
    title: "Tablet Screen Repair",
    category: "Smartphone",
    description: "Cracked tablet glass and digitizer replacement for popular tablet models.",
    image: img("Tablet Screen Repair"),
    basePrice: 55,
    approvalStatus: "pending",
    createdAt: new Date(now),
  });
  const inserted = await services.insertMany(docs);
  const ids = Object.values(inserted.insertedIds).map(String);

  const make = (idx: number, status: string, paid: boolean, extra: Record<string, unknown> = {}) => {
    const s = docs[idx];
    const created = new Date(now - (idx + 1) * day);
    const history = ["requested", "accepted", "in-progress", "completed"];
    const upto = status === "rejected" ? ["requested", "rejected"] : status === "cancelled" ? ["requested", "cancelled"] : history.slice(0, history.indexOf(status) + 1);
    const statusHistory = upto.map((st, k) => ({ status: st, changedAt: new Date(created.getTime() + k * 3600_000) }));
    if (paid) statusHistory.push({ status: "paid", changedAt: new Date(created.getTime() + 5 * 3600_000) });
    return {
      serviceId: ids[idx],
      serviceTitle: s.title,
      serviceImage: s.image,
      category: s.category,
      basePrice: s.basePrice,
      technicianName: s.technicianName,
      technicianEmail: s.technicianEmail,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: "01711000000",
      address: "House 12, Road 5, Dhanmondi, Dhaka",
      preferredDate: new Date(now + 2 * day),
      problemDescription: "The device stopped working properly after a recent drop; please check and repair it.",
      status,
      finalAmount: s.basePrice,
      paymentStatus: paid ? "paid" : "unpaid",
      statusHistory,
      createdAt: created,
      ...extra,
    };
  };

  const bookingDocs = [
    make(0, "requested", false),
    make(4, "accepted", false),
    make(2, "in-progress", false),
    make(6, "completed", false, { finalAmount: 78 }),
    make(10, "completed", true, { finalAmount: 72, rating: 5, review: "Quick, tidy work and the machine runs silently now. Highly recommend!", reviewedAt: new Date(now - day) }),
    make(12, "completed", true, { finalAmount: 40, rating: 4, review: "Found the faulty breaker fast. Fair price.", reviewedAt: new Date(now - day) }),
    make(8, "rejected", false),
    make(3, "cancelled", false),
  ];
  const bres = await bookings.insertMany(bookingDocs);
  const bIds = Object.values(bres.insertedIds);

  const paidDocs = bookingDocs
    .map((b, i) => ({ b, id: bIds[i] }))
    .filter(({ b }) => b.paymentStatus === "paid")
    .map(({ b, id }, n) => ({
      bookingId: String(id),
      serviceTitle: b.serviceTitle,
      customerName: b.customerName,
      customerEmail: b.customerEmail,
      technicianName: b.technicianName,
      technicianEmail: b.technicianEmail,
      amount: b.finalAmount,
      currency: "usd",
      transactionId: `pi_seed_${n + 1}`,
      stripeSessionId: `cs_test_seed_${n + 1}`,
      paymentStatus: "paid",
      paidAt: new Date(now - (n + 1) * day),
    }));
  await payments.insertMany(paidDocs);

  console.log(`Seeded ${docs.length} services, ${bookingDocs.length} bookings, ${paidDocs.length} payments.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
