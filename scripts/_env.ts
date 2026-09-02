// Laadt .env.local en .env (in die volgorde) voor CLI-scripts, net als Next.js.
import { config } from "dotenv";

config({ path: ".env.local" });
config();
