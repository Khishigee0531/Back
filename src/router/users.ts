import express from "express";

import {
  deleteUser,
  getAllUsers,
  me,
  updateUser,
  withdrawUser,
} from "../controllers/users";
import authentication from "./authentication";
import { login, register } from "../controllers/authentication";
import { auth } from "../middlewares";

export default (router: express.Router) => {
  router.post("/users/login", login);
  router.post("/users/register", register);
  authentication(router);
  router.get("/users", auth, getAllUsers);
  router.put("/users/:id", auth, updateUser);
  router.delete("/users/:id", auth, deleteUser);
  router.get("/users/me", auth, me);
  router.post("/users/withdraw",auth, withdrawUser);

  return router;
};
