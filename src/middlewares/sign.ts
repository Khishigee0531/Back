import express, { NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { IUser } from "../db/Users";

export interface Request extends express.Request {
  user?: IUser | null;
  deviceToken?: string | null;
  deviceImei?: string | null;
  sessionScope?: string | null;
}

export type Response = express.Response;

type SignProps = {
  user: IUser;
  refreshToken?: string;
  expiresIn?: number;
};
type OtpProps = {
  user: any;
  expiresIn?: number;
};

export const signIn = async (
  res: Response,
  { user, refreshToken, expiresIn }: SignProps,
  SESSION_SCOPE = "AUTHORIZED"
) => {
  const accessToken = jwt.sign(
    {
      uid: user.id,
      scp: SESSION_SCOPE,
    },
    config.jwt.jwtSecret,
    expiresIn ? { expiresIn: expiresIn } : {}
  );

  user.set({
    sessionScope: SESSION_SCOPE,
  });

  await user.save();

  res.cookie(config.server.name + ".sec", accessToken, {
    expires: new Date((expiresIn || 1) * 1000),
    secure: false, // set to true if your using https
    httpOnly: true,
  });

  res.json({
    tokenType: "Bearer",
    user: {
      ...user.toObject(),
      authentication: undefined,
    },
    token: accessToken,
    refreshToken: refreshToken,
    sessionScope: SESSION_SCOPE,
  });
};
export const otpGenerate = async (
  res: express.Response,
  { user, expiresIn }: OtpProps,
  SESSION_SCOPE = "OTP_VERIFY"
) => {
  const accessToken = jwt.sign(
    {
      uid: user._id,
      scp: SESSION_SCOPE,
    },
    config.jwt.jwtSecret,
    expiresIn ? { expiresIn: expiresIn } : {}
  );
  res.cookie(config.server.name, accessToken, {
    expires: new Date((expiresIn || 1) * 1000),
    secure: false, // set to true if your using https
    httpOnly: true,
  });

  res.json({
    tokenType: "Bearer",
    user,
    token: accessToken,
    sessionScope: SESSION_SCOPE,
  });
};
export const otpConfirmed = async (
  res: express.Response,
  { user, expiresIn }: OtpProps,
  SESSION_SCOPE = "OTP_CONFIRMED"
) => {
  const accessToken = jwt.sign(
    {
      uid: user._id,
      scp: SESSION_SCOPE,
    },
    config.jwt.jwtSecret,
    expiresIn ? { expiresIn: expiresIn } : {}
  );
  res.cookie(config.server.name + ".sec", accessToken, {
    expires: new Date((expiresIn || 1) * 1000),
    secure: false, // set to true if your using https
    httpOnly: true,
  });

  res.json({
    tokenType: "Bearer",
    user,
    token: accessToken,
    sessionScope: SESSION_SCOPE,
  });
};
export const profileCreate = async (
  res: express.Response,
  { user, expiresIn }: OtpProps,
  SESSION_SCOPE = "PROFILE_CREATED"
) => {
  const accessToken = jwt.sign(
    {
      uid: user._id,
      scp: SESSION_SCOPE,
    },
    config.jwt.jwtSecret,
    expiresIn ? { expiresIn: expiresIn } : {}
  );
  res.cookie(config.server.name + ".sec", accessToken, {
    expires: new Date((expiresIn || 1) * 1000),
    secure: false, // set to true if your using https
    httpOnly: true,
  });

  res.json({
    tokenType: "Bearer",
    user,
    token: accessToken,
    sessionScope: SESSION_SCOPE,
  });
};
export const authComplete = async (
  res: express.Response,
  { user, expiresIn }: OtpProps,
  SESSION_SCOPE = "AUTHORIZED"
) => {
  const accessToken = jwt.sign(
    {
      uid: user._id,
      scp: SESSION_SCOPE,
    },
    config.jwt.jwtSecret,
    expiresIn ? { expiresIn: expiresIn } : {}
  );
  res.cookie(config.server.name + ".sec", accessToken, {
    expires: new Date((expiresIn || 1) * 1000),
    secure: false, // set to true if your using https
    httpOnly: true,
  });

  res.json({
    tokenType: "Bearer",
    user,
    token: accessToken,
    sessionScope: SESSION_SCOPE,
  });
};

export const signOut = (res: Response) => {
  res.clearCookie(config.server.name + ".sec");
  res.json({});
};

export const sign =
  (scope?: string | null) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const { "device-token": deviceToken, "device-imei": deviceImei } =
      req.headers;

    try {
      req.deviceToken = deviceToken as string;
      req.deviceImei = deviceImei as string;
      req.sessionScope = scope;

      next();
    } catch (err) {
      next(err);
    }
  };
export const createExpireIn = (expireIn: number, type: "hours" | "minutes") => {
  if (type === "hours") {
    const seconds = expireIn * 60 * 60;
    return Math.floor(Date.now() / 1000) + seconds;
  } else {
    // convert expireIn to seconds
    const seconds = expireIn * 60;
    return Math.floor(Date.now() / 1000) + seconds;
  }
};
