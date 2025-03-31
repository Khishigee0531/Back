import express from "express";
import authentication from "./authentication";
import { auth } from "../middlewares";
import { depositUser,  getDepostiList, getWithdrawList,withdrawTransfer } from "../controllers/admins";

export default (router: express.Router) => {
  authentication(router);
  router.post("/admin/deposit",auth, depositUser);
  router.get("/admin/deposit", auth, getDepostiList);
  
  router.get("/admin/withdraw", auth, getWithdrawList);
  router.post("/admin/withdraw/transfer", auth, withdrawTransfer);

  return router;
};
