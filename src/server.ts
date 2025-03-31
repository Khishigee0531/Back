import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import mongoose from "mongoose";
import fileUpload from "express-fileupload";
import "express-async-errors";
import { createClientRouter } from "./router";
import errorHandler from "./middlewares/error";
import path from "path";
import { initDatabase } from "./dbInitializer";
import { Server } from "socket.io";
import http from "http";
import setupSocket from "./socket";

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3012",
  "http://localhost:3011",
  "https://tsuivan.store",
  "https://www.tsuivan.store",
  "https://wukongtest.boosters.mn",
  "https://www.wukongtest.boosters.mn",
  "https://admin.tsuivan.store",
  "https://www.admin.tsuivan.store",
  "http://www.ochirpoker.online/",
    /\.tsuivan\.store$/, // Matches any subdomain
  /\.boosters\.mn$/, // Matches any subdomain
];
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const port = 3011;

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        console.log(`Blocked origin: ${origin}`);
        const msg = "The CORS policy for this site does not allow access from the specified Origin.";
        return callback(new Error(msg), false);
      }
    },
    credentials: true,
  })
);

app.use(fileUpload());
app.use(compression());
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(process.cwd(), "public")));

const MONGO_URI = "mongodb+srv://noskr:0401@mydb.5msnhth.mongodb.net/pocker";

mongoose.Promise = Promise;
mongoose.connect(MONGO_URI, {
  tlsAllowInvalidCertificates: true,
});
mongoose.connection.on("error", (error) => {
  console.log("MongoDB connection error: " + error);
  process.exit(-1);
});

mongoose.connection.once("open", async () => {
  console.log("Connected to MongoDB");
  await initDatabase();
});

app.use("/", createClientRouter());
app.use(errorHandler);

setupSocket(io);

server.listen(port, () => {
  console.log(`Client server is running on http://localhost:${port}`);
});