import mongoose from "mongoose";
import { IUser } from './Users';

export enum IWithdrawStatus {
  Pending = "Pending",
  Success = "Success",
}

export interface IWithdraw extends mongoose.Document {
  amount: number;
  user: IUser;
  createdAt: Date;
  type: IWithdrawStatus
}

const WithdrawSchema = new mongoose.Schema({
  
  amount: {
    type: Number,
    default: 0,
  },
  status: {
    enum: ["Pending", "Success"],
    default: "Pending",
    type: String
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: false,
  },
 
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export const Withdraw = mongoose.model("Withdraw", WithdrawSchema);
