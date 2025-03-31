import { IDeposit } from './Deposit';
import { IWithdraw } from './Withdraw';
import mongoose, { Schema } from "mongoose";
import jwt from "jsonwebtoken";
import { config } from "../config";
import MyError from "../utils/myError";
import bcrypt from "bcryptjs";

export interface IUser extends mongoose.Document {
  name: string;
  role: string;
  withdrawAmount: number;
  depositAmount: number;
  withdrawes: IWithdraw[];
  deposites: IDeposit[];
  authentication: {
    password: string;
    salt: string;
    sessionToken: string;
  };
  bankType: string;
  bankAccount: string;
  amount: number;
  sessionScope: string;
  createdAt: Date;
  validatePassword: (password: string) => Promise<boolean>;
  getJsonWebToken(): string;
}

const UserSchema = new mongoose.Schema({
  name: String,
  withdrawAmount: {
    type: Number,
    default: 0,
  },
  bankType: String,
  bankAccount: String,
  depositAmount: {
    type: Number,
    default: 0,
  },
  amount: {
    type: Number,
    default: 0,
  },
  role: {
    enum: ["user", "operator", "admin"],
    default: "user",
    type: String,
  },
  withdrawes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Withdraw",
  }],
  withdrawesPending: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Withdraw",
  }],
  deposites: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Deposit",
  }],
  authentication: {
    password: {
      type: String,
      // required: true,
      select: false,
    },
    salt: {
      type: String,
      select: false,
    },
    sessionToken: {
      type: String,
      select: false,
    },
  },
  sessionScope: {
    type: String,
    default: "UNAUTHORIZED",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export const User = mongoose.model("User", UserSchema);

UserSchema.methods.validatePassword = async function (password: string) {
  if (!this.password) throw new MyError("Хүсэлт амжилтгүй", 401);
  const valid = await bcrypt.compare(password, this.password);
  return valid;
};

export const createUser = async (values: Record<string, any>) =>
  new User(values).save().then((user) => user.toObject());
export const findUser = async (username: string) => {
  return User.findOne({ username });
};
export const getUsers = async (filters?: any) => {
  return User.find(filters).populate("wallet");
};
export const getUserById = async (id: string) => {
  return User.findById(id);
};
export const updateUser = async (id: string, authentication: any) => {
  return User.findByIdAndUpdate(
    id,
    { authentication, sessionScope: "AUTHORIZED" },
    { new: true }
  );
};

export const updatePassword = async (id: string, password: any) => {
  return User.findByIdAndUpdate(
    id,
    { password, sessionScope: "AUTHORIZED" },
    { new: true }
  );
};
export const getUserBySessionToken = async (sessionToken: string) => {
  return User.findOne({ "authentication.sessionToken": sessionToken });
};
export const deleteUserById = async (id: string) => {
  return User.findByIdAndDelete(id);
};
export const findUserByEmail = async (email: string) => {
  return User.findOne({ email });
};
export const validatePassword = (password: string): boolean => {
  const minLength = 8;
  const hasUppercase = /[A-Z]/.test(password);
  return password.length >= minLength && hasUppercase;
};

UserSchema.methods.getJsonWebToken = function () {
  return jwt.sign({ id: this._id }, config.jwt.jwtSecret, {
    expiresIn: config.jwt.jwtExpiresIn,
  });
};
