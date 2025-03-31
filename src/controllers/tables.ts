import express from "express"
import { Request } from "../middlewares/sign"
import MyError from "../utils/myError"
import Table from "../db/Table"
import { Player } from "../db/Player"

export const createTable = async (req:Request, res:express.Response) => {
  const {
    name,
    maxPlayers,
    buyIn,
    smallBlind,
    bigBlind,
    gameType,
    minimumBet = 10
   } = req.body;
   if(!name){
    throw new MyError("Нэр оруулна уу!", 400)
   }
   if(!maxPlayers){
    throw new MyError("Боломжит суудал оруулна уу!", 400)
   }
   if(!buyIn){
    throw new MyError("Доод орох дүнг оруулна уу!", 400)
   }
   if(!smallBlind){
    throw new MyError("Small blind оруулна уу", 400)
   }
   if(!bigBlind){
    throw new MyError("Big blind оруулна уу", 400)
   }
   if(!gameType){
    throw new MyError("Тоглоомын төрөл оруулна уу", 400)
   }
   try{
    const newLobby = new Table({
      name, maxPlayers, buyIn, smallBlind, bigBlind, gameType, minimumBet
    });
    await newLobby.save();

    return res.status(200).json(newLobby)
   } catch(err){
    console.log(err, "-------> LOBBY CREATED")
    throw new MyError("Алдаа гарлаа", 500)
   }
}

export const getTables = async (req:Request, res:express.Response) => {
  try{
    const lobbys = await Table.find();
    return res.status(200).json(lobbys);
  } catch(err){
    throw new MyError("Алдаа гарлаа",500)
  }
}

export const deleteTable = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const { id } = req.params;
    const table = await Table.findByIdAndDelete(id);
    if (!table) {
      throw new MyError("Хүснэгт олдсонгүй", 404);
    }
    await Player.deleteMany({ tableId: id });
    return res.status(200).json(table)
  } catch (error) {
    return res.sendStatus(400);
  }
};

