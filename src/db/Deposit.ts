import mongoose from "mongoose";
import { IUser } from './Users';

export interface IDeposit extends mongoose.Document {
  amount: number;
  user: IUser;
  createdAt: Date;
}

const DepositSchema = new mongoose.Schema({
  
  amount: {
    type: Number,
    default: 0,
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

export const Deposit = mongoose.model("Deposit", DepositSchema);
