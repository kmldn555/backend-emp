import express from "express";
import { globalError, notFoundError } from "./utils/errors.js";
import { authRoutes } from "./routes/user.auth.route.js";
import cors from "cors";

const PORT = 8000;

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api", (req, res) => res.status(200).send("Welcome to my API"));

// entrypoint
app.use("/auth", authRoutes)


// errors
app.use(globalError);
app.use(notFoundError)

app.listen(PORT, () => console.log(`Server running on port : ${PORT}`));
