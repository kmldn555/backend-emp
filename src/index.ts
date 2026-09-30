import express from "express";
import { globalError, notFoundError } from "./utils/errors.js";

const PORT = 8000;

const app = express();

app.use(express.json());

app.get("/api", (req, res) => res.status(200).send("Welcome to my API"));

// entrypoint


// errors
app.use(globalError);
app.use(notFoundError)

app.listen(PORT, () => console.log(`Server running on port : ${PORT}`));
