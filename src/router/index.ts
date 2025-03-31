import express from "express";
import authentication from "./authentication";
import users from "./users";
import table from "./table";
import admins from "./admins";
const clientRouter = express.Router();

export const createClientRouter = (): express.Router => {
  authentication(clientRouter);
  users(clientRouter);
  table(clientRouter);
  admins(clientRouter);
  return clientRouter;
};
