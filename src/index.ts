import express from "express";
import { globalError, notFoundError } from "./utils/errors.js";
import { authRoutes } from "./routes/user.auth.route.js";
import cors from "cors";
import { eventRoutes } from "./routes/event.routes.js";
import { profileRoutes } from "./routes/user.profile.route.js";

import { transactionRoutes } from "./routes/transaction.routes.js";
import { adminDashboardRoutes } from "./routes/dashboard/admin.dashboard.route.js";
import { organizerDashboardRoutes } from "./routes/dashboard/organizer.dashboard.route.js";
import {categoryRoutes} from "./routes/category.route.js";
import { startTransactionCronJob } from "./jobs/transaction.cron.js";
import reviewRoutes from "./routes/review.route.js";

const PORT = 8000;

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api", (req, res) => res.status(200).send("Welcome to my API"));

// entrypoint
app.use("/auth", authRoutes);
app.use("/events", eventRoutes);
app.use("/profile", profileRoutes);
app.use("/categories", categoryRoutes);
app.use("/transactions", transactionRoutes);

// entrypoint dashboard
app.use("/admin", adminDashboardRoutes);
app.use("/organizer", organizerDashboardRoutes)
app.use("/reviews", reviewRoutes);

startTransactionCronJob()
// errors
app.use(globalError);
app.use(notFoundError);

app.listen(PORT, () => console.log(`Server running on port : ${PORT}`));

