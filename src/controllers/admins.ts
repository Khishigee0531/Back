import express from "express";

import { User } from "../db/Users";
import MyError from "../utils/myError";
import { Deposit } from "../db/Deposit";
import { IWithdrawStatus, Withdraw } from "../db/Withdraw";
/**
 * @author tushig
 */

export const depositUser = async (req:express.Request, res: express.Response) => {
  try{
    const {id, amount} = req.body
    if(!id || !amount){
      throw new MyError("Хэрэглэгч болон мөнгөн дүн оруулна уу", 400)
    }
    const user = await User.findById(id);

    if(!user){
      throw new MyError("Хэрэглэгч олдсонгүй", 400)
    }

    const deposit = await Deposit.create({
      user: user._id,
      amount,
    });
    if(!deposit){
      throw new MyError("Дэпосит хийхэд алдаа гарлаа",500)
    }
    const allDepo = [...user.deposites, deposit._id];
    user.amount = Number(user.amount) + Number(amount);
    user.depositAmount = Number(user.depositAmount) + Number(amount);
    user.deposites= allDepo
    
    await user.save();
    return res.status(200).json(user)

  } catch(err){
    throw new MyError("Серверийн алдаа", 500)
  }
}

export const getDepostiList = async (req:express. Request, res: express.Response) => {
  const {page} = req.query
  const pageNumber = Math.max(Number(page),1)
  try{
    const filters: {[key: string]: any} = {}
    const total = await Deposit.countDocuments(filters);
    const deposites = await Deposit.find(filters)
    .populate("user")
    .skip((pageNumber- 1) * 10)
    .limit(10)
    .lean()
    const totalPages = Math.ceil(total /10)
    return res.status(200).json({
      data:deposites,
      total,
      totalPages,
      currentPage: pageNumber
    })
  } catch(err){
    throw new MyError("Серверийн алдаа", 500)
  }
}

export const getWithdrawList = async (req:express.Request, res: express.Response) => {
  const {page, status, search} = req.query;
  const pageNumber = Math.max(Number(page), 1);
  try{
    const filters: {[key: string]: any} = {};
    if(status){
      filters.status = {
        $regex: new RegExp((status as string).trim(), "i")
      }
    }
    if (search) {
      filters["user.name"] = {
      $regex: new RegExp((search as string).trim(), "i")
      };
    }
    const total = await Withdraw.countDocuments(filters);
    const withdrawes = await Withdraw.find(filters)
    .populate("user")
    .skip((pageNumber -1 ) * 10)
    .limit(10)
    .lean()
    const totalPages = Math.ceil(total/10)
    return res.status(200).json({
      data:withdrawes,
      total,
      totalPages,
      currentPage: pageNumber
    })
  } catch(err){
    throw new MyError("Серверийн алдаа", 500)
  }
}

export const withdrawTransfer = async (req:express.Request, res:express.Response) => {
  try{
    const {userId, withdrawId} = req.body;
    const user = await User.findById(userId)
    const withdraw = await Withdraw.findById(withdrawId)
    
    if(!user){
      throw new MyError("Хэрэглэгч олдсонгүй", 500)
    }
    if(!withdraw){
      throw new MyError("Буцаалт хүсэлт олдсонгүй", 500)
    }

    withdraw.status = IWithdrawStatus.Success;
    await withdraw.save();

    return res.status(200).json(withdraw)

  } catch(err){
    throw new MyError("Серверийн алдаа", 500)
  }
}
