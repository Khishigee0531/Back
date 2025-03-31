import express from "express";
import { createUser, IUser, User } from "../db/Users";
import { createExpireIn, Request, signIn } from "../middlewares/sign";
import MyError from "../utils/myError";
import { authentication } from "../helpers";
import crypto from "crypto";

export const login = async (req: express.Request, res: express.Response) => {
  const { name, password } = req.body;
  console.log(name, password);
  try {
    const user = (await User.findOne({ name: name }).select(
      "+authentication.salt +authentication.password"
    )) as IUser;

    if (!user) {
      throw new MyError("Хэрэглэгч олдсонгүй.", 401);
    }

    if (
      !user.authentication ||
      !user.authentication.salt ||
      !user.authentication.password
    ) {
      throw new MyError("Нэвтрэх мэдээлэл алга байна.", 401);
    }

    const expectedHash = authentication(user.authentication.salt, password);
    if (user.authentication.password !== expectedHash) {
      throw new MyError("Нууц үг буруу байна.", 401);
    }

    user.set({
      sessionScope: "AUTHORIZED",
    });
    await user.save();

    signIn(
      res,
      {
        user: user,
        expiresIn: createExpireIn(24 * 30, "hours"),
      },
      "AUTHORIZED"
    );
  } catch (error) {
    if (error instanceof MyError) {
      throw new MyError(error.message, error.statusCode);
    }
    throw new MyError("Серверийн алдаа гарлаа.", 500);
  }
};


const random = () => crypto.randomBytes(128).toString("base64");

export const register = async (req: express.Request, res: express.Response) => {
  const { name, password, amount, bankAccount,
    bankType, role = "user" } = req.body;
  const existingUser = await User.findOne({ name });
  if (existingUser) {
    throw new MyError("Утасны дугаар бүртгэлтэй байна!", 403);
  }
  if (!name) {
    throw new MyError("Утасны дугаар оруулна уу!", 403);
  }
  if (!password) {
    throw new MyError("Нууц үг оруулна уу!", 403);
  }
  if(!bankAccount){
    throw new MyError("Дансны дугаараа оруулна уу", 403)
  }
  if(!bankType){
    throw new MyError("Харилцах банкаа оруулна уу", 403)
  }
  const salt = random();
  const auth = {
    password: authentication(salt, password),
    salt,
  };

  try {
    const newUser = new User({
      name,
      password,
      amount,
      authentication: auth,
      bankAccount,
      bankType,
      role
    });

    if (!newUser) {
      throw new MyError("Хэрэглэгч хадгалахад алдаа гарлаа!", 403);
    }
    await newUser.save();
    return res.status(200).json(newUser);
  } catch (err) {
    console.log(err);
    throw new MyError("Серверийн алдаа!", 403);
  }
};

export const getToken = async (): Promise<string> => {
  const response = await fetch("https://merchant.qpay.mn/v2/auth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic T05UU19NTjpmajRuMVcxeg=`,
      "Content-Type": "application/json",
    },
  });
  const data = await response.json();
  return data.access_token;
};

export const logout = async (req: Request, res: express.Response) => {
  try {
    const user = await User.findById(req.user?._id);

    if (!user) {
      throw new MyError("Хэрэглэгч олдсонгүй.", 401);
    }

    user.set({
      sessionScope: "UNAUTHORIZED",
    });
    await user.save();

    res.clearCookie('sessionToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });

    return res.status(200).json({
      success: true,
      message: "Амжилттай гарлаа"
    });

  } catch (error) {
    if (error instanceof MyError) {
      throw new MyError(error.message, error.statusCode);
    }
    throw new MyError("Гарах үед алдаа гарлаа.", 500);
  }
};


