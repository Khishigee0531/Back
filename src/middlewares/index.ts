import { NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { IUser, User } from "../db/Users";
import { Request, Response } from "./sign";
import MyError from "../utils/myError";
import { ObjectId } from "mongodb";
/**
 * @author tushig
 */
type JwtExpPayload = {
  uid: string;
  scp: string;
  sid: string;
};
export const auth = async (req: Request, res: Response, next: NextFunction) => {
  const header = `${req.headers.authorization}`;

  try {
    let decoded;

    try {
      decoded = jwt.verify(
        header?.split(" ")[1],
        config.jwt.jwtSecret
      ) as JwtExpPayload;
      // console.log(`🚀 ~ ${req.path} auth decoded`, decoded);
    } catch (err) {
      // console.log(`🚀 ~ ${req.path} auth err`, err);
      throw new MyError("Та нэвтрэх шаардлагатай", 401);
    }

    const user = await User.findOne({ _id: new ObjectId(decoded?.uid) });
    if (!user) throw new MyError("Хэрэглэгч олдсонгүй", 401);

    req.user = user as unknown as IUser;
    req.sessionScope = decoded.scp;

    // console.log(`🚀 ~ ${req.path} auth middleware done`);
    next();
  } catch (err) {
    next(err);
  }
};
