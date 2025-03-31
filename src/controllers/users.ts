import express from "express";

import { deleteUserById, User } from "../db/Users";
import MyError from "../utils/myError";
import { Request } from "../middlewares/sign";
import { Withdraw } from "../db/Withdraw";

export const me = async (req: Request, res: express.Response) => {
  try {
    const user = await User.findById(req.user?._id);
    if (!user) {
      return res.status(201);
    }
    return res.status(200).json(user).end();
  } catch (error) {
    return;
  }
};

export const getAllUsers = async (
  req: express.Request,
  res: express.Response
) => {
  const {  page, search } = req.query;
  const pageNumber = Math.max(Number(page), 1);

  try {
    // Construct filters object for users
    const filters: { [key: string]: any } = {};
    if(search){
      filters["name"] = {
        $regex: new RegExp((search as string).trim(), "i")
      };
    }
    const total = await User.countDocuments(filters);
    const users = await User.find(filters)
      .skip((pageNumber - 1) * 10)
      .limit(10)
      .lean(); // Use lean to get plain JS objects for faster access

    const totalPages = Math.ceil(total / 10);

    return res.status(200).json({
      users,
      total,
      totalPages,
      currentPage: pageNumber,
    });
  } catch (error) {
    console.error(error);
    return res.sendStatus(400);
  }
};

export const updateUser = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const user = await User.findByIdAndUpdate(id, updateData, { new: true });
    if (!user) {
      throw new MyError("Хэрэглэгч олдсонгүй", 404);
    }
    return res.status(200).json(user);
  } catch (error) {
    throw new MyError("Амжилтгүй хөгжүүлэгчид хандана уу!", 500);
  }
};

export const deleteUser = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const { id } = req.params;
    const user = await deleteUserById(id);
    return res.status(200).json(user)
  } catch (error) {
    return res.sendStatus(400);
  }
};

export const getUser = async (req: express.Request, res: express.Response) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) {
      throw new MyError("Хэрэглэгч олдсонгүй", 404);
    }
    
    return res.status(200).json(user);
  } catch (error) {
    return res.sendStatus(400);
  }
};

export const withdrawUser = async (req:express.Request, res: express.Response) => {
  try{
    const {id, amount} = req.body
    if(!id || !amount){
      throw new MyError("Хэрэглэгч болон мөнгөн дүн оруулна уу", 400)
    }
    const user = await User.findById(id);

    if(!user){
      throw new MyError("Хэрэглэгч олдсонгүй", 400)
    }

    const withdraw = await Withdraw.create({
      user: user._id,
      amount,
    });
    if(!withdraw){
      throw new MyError("Буцаалт хийхэд алдаа гарлаа",500)
    }
    const pending = [...user.withdrawesPending, withdraw._id]
    user.amount = Number(user.amount) - Number(amount);
    user.withdrawesPending = pending
    await user.save();
    return res.status(200).json(user)

  } catch(err){
    throw new MyError("Серверийн алдаа", 500)
  }
}



