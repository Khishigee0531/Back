// socket/eventHandlers.ts
import { Server, Socket } from "socket.io";
import mongoose, { ObjectId } from "mongoose";
import { Player } from "../db/Player"; // Adjust path to your models
import Table, { IMessage } from "../db/Table"; // Adjust path to your models
import { User } from "../db/Users"; // Adjust path to your models
import { advanceTurn } from "./game-logic"; // Import game logic

interface SocketData {
  userId: string;
  tableId: string | null;
}

export const handleGetTableData = (socket: Socket) => async (tableId: string) => {
  try {
    const table = await Table.findById(tableId)
      .populate("players")
      .populate("waitingPlayers")
      .populate("messages.user")
      .lean();
    if (!table) {
      return socket.emit("error", "Table not found");
    }
    socket.emit("tableData", table);
  } catch (error) {
    socket.emit("error", "Error fetching table data");
    console.error(error);
  }
};

export const handleGetLobbyList = (socket: Socket) => async () => {
  const tables = await Table.find().lean();
  socket.emit("lobbyList", tables);
};

export const handleSendMessage = (socket: Socket, io: Server) => async ({
  lobbyId,
  userId,
  content,
}: {
  lobbyId: string;
  userId: string;
  content: string;
}) => {
  const lobby = await Table.findById(lobbyId);
  if (!lobby) {
    socket.emit("error", { message: "Lobby not found" });
    return;
  }

  const message = { user: userId, content, timestamp: new Date() };
  lobby.messages.push(message as unknown as IMessage);
  await lobby.save();

  const populatedLobby = await Table.findById(lobbyId)
    .populate("messages.user", "name")
    .lean();
  if (!populatedLobby) {
    socket.emit("error", { message: "Failed to populate lobby" });
    return;
  }

  const latestMessage = populatedLobby.messages[populatedLobby.messages.length - 1];
  io.to(lobbyId).emit("newMessage", {
    user: { _id: latestMessage.user._id, name: (latestMessage.user as any).name },
    content: latestMessage.content,
    timestamp: latestMessage.timestamp,
  });
};

export const handleJoinTable = (socket: Socket, io: Server, socketData: SocketData) => async ({
  userId,
  tableId,
}: {
  userId: string;
  tableId: string;
}) => {
  try {
    if (!userId) {
      socket.join(tableId);
      const updatedTable = await Table.findById(tableId)
        .populate("players")
        .populate("waitingPlayers")
        .lean();
      socket.emit("joinedTable", updatedTable);
      io.to(tableId).emit("tableUpdate", updatedTable);
      return;
    }

    const [table, user] = await Promise.all([
      Table.findById(tableId).populate("players").lean(),
      User.findById(userId),
    ]);

    if (!table) {
      return socket.emit("error", "Table not found");
    }

    if (user) {
      if (user.amount < table.buyIn) {
        return socket.emit("error", "Insufficient funds");
      }
      if (table.players.length >= table.maxPlayers) {
        return socket.emit("error", "Table full");
      }

      socketData.userId = userId;
      socketData.tableId = tableId;
      socket.join(tableId);

      const existingPlayer = await Player.findOne({ user: userId, table: tableId }).lean();
      if (!existingPlayer) {
        const player = new Player({
          user: userId,
          table: tableId,
          socketId: socket.id,
          seat: -1,
          chips: table.buyIn,
          username: user.name,
          cards: ["", ""],
          inHand: false,
          currentBet: 0,
          hasActed: false,
          consecutiveAfkRounds: 0,
        });
        await player.save();
        await Table.findByIdAndUpdate(tableId, { $push: { waitingPlayers: player._id } });
      }
    }

    const updatedTable = await Table.findById(tableId)
      .populate("players")
      .populate("waitingPlayers")
      .lean();
    io.to(tableId).emit("tableUpdate", updatedTable);
    socket.emit("joinedTable", updatedTable);
  } catch (error) {
    socket.emit("error", "Error joining table");
    console.error(error);
  }
};

export const handleJoinSeat = (socket: Socket, io: Server, startGame: (tableId: string, io: Server) => Promise<void>) => async ({
  tableId,
  seat,
  userId,
  chips,
}: {
  tableId: string;
  seat: number;
  userId: string;
  chips?: number;
}) => {
  try {
    const table = await Table.findById(tableId).populate("players").populate("waitingPlayers").lean();
    if (!table || !userId) {
      return socket.emit("error", "Invalid table or user");
    }

    const player = await Player.findOne({ user: userId, table: tableId });
    if (!player) {
      return socket.emit("error", "Player not found");
    }

    const seatTaken = table.players.some((p: any) => p.seat === seat);
    if (seatTaken || seat < 0 || seat >= table.maxPlayers) {
      return socket.emit("error", "Invalid or taken seat");
    }

    const chipsToUse = chips && chips >= table.buyIn ? chips : table.buyIn;
    if (chips && chips < table.buyIn) {
      return socket.emit("error", `Chips must be at least ${table.buyIn}`);
    }

    await Promise.all([
      Player.findOneAndUpdate(
        { _id: player._id, table: tableId },
        { seat, inHand: false, chips: chipsToUse },
        { new: true }
      ),
      Table.findByIdAndUpdate(
        tableId,
        {
          $pull: { waitingPlayers: player._id },
          $push: { players: player._id },
        },
        { new: true }
      ),
    ]);

    const updatedTable = await Table.findById(tableId).populate("players").populate("waitingPlayers").lean();
    io.to(tableId).emit("tableUpdate", updatedTable);
    socket.emit("seatJoined", { table: updatedTable, seat });

    if (updatedTable!.players.length === 2 && updatedTable!.status === "waiting") {
      await startGame(tableId, io);
    }
  } catch (error) {
    socket.emit("error", "Error joining seat");
    console.error(error);
  }
};

export const handleAddChips = (socket: Socket, io: Server) => async ({
  tableId,
  userId,
  amount,
}: {
  tableId: string;
  userId: string;
  amount: number;
}) => {
  try {
    if (!tableId || !userId || !amount || amount <= 0) {
      return socket.emit("error", "Invalid table, user, or amount");
    }

    const [table, user] = await Promise.all([
      Table.findById(tableId).populate("players").lean(),
      User.findById(userId),
    ]);

    if (!table || !user) {
      return socket.emit("error", "Table or user not found");
    }

    const player = await Player.findOne({ user: userId, table: tableId });
    if (!player || player.seat === -1 || table.status === "playing") {
      return socket.emit("error", "Cannot add chips at this time");
    }

    if (user.amount < amount) {
      return socket.emit("error", "Insufficient balance");
    }

    await Promise.all([
      Player.findOneAndUpdate({ _id: player._id, table: tableId }, { $inc: { chips: amount } }, { new: true }),
      User.findByIdAndUpdate(userId, { $inc: { amount: -amount } }, { new: true }),
    ]);

    const updatedTable = await Table.findById(tableId).populate("players").populate("waitingPlayers").lean();
    io.to(tableId).emit("chipsAdded", { tableId, userId, amount });
    io.to(tableId).emit("tableUpdate", updatedTable);
    socket.emit("chipsAddedSuccess", { tableId, amount });
  } catch (error) {
    socket.emit("error", "Failed to add chips");
    console.error(error);
  }
};

export const handleLeaveSeat = (socket: Socket, io: Server, endGame: (tableId: string, io: Server) => Promise<void>) => async (
  tableId: string
) => {
  try {
    const table = await Table.findById(tableId).populate("players").lean();
    const socketData = socket.data as SocketData;
    if (!table || !socketData.userId) {
      return socket.emit("error", "Invalid table or user");
    }

    const player = await Player.findOne({ user: socketData.userId, table: tableId });
    if (!player) {
      return socket.emit("error", "Player not found");
    }

    await Promise.all([
      Player.findOneAndUpdate({ _id: player._id, table: tableId }, { seat: -1, inHand: false }, { new: true }),
      Table.findByIdAndUpdate(tableId, { $pull: { players: player._id }, $push: { waitingPlayers: player._id } }, { new: true }),
    ]);

    const updatedTable = await Table.findById(tableId).populate("players").populate("waitingPlayers").lean();
    io.to(tableId).emit("tableUpdate", updatedTable);
    socket.emit("seatLeft", updatedTable);

    if (updatedTable!.players.length < 2 && updatedTable!.status === "playing") {
      await endGame(tableId, io);
    }
  } catch (error) {
    socket.emit("error", "Error leaving seat");
    console.error(error);
  }
};

export const handleGameAction = (socket: Socket, io: Server) => async ({
  tableId,
  action,
  amount,
  userId,
}: {
  tableId: string;
  action: string;
  amount?: number;
  userId: string;
}) => {
  try {
    const table = await Table.findById(tableId).populate("players").lean();
    if (!table || table.status !== "playing") {
      return socket.emit("error", "Table or Game not in progress");
    }

    const player = await Player.findOne({ user: userId, table: tableId });
    if (!player || !player.inHand || (player._id as ObjectId).toString() !== (table.players[table.currentPlayer] as any)._id.toString()) {
      return socket.emit("error", "Not your turn or not in hand");
    }

    let update: any = { hasActed: true };
    let tableUpdate: any = {};

    switch (action.toLowerCase()) {
      case "fold":
        update.inHand = false;
        break;
      case "check":
        if (player.currentBet < table.currentBet) {
          return socket.emit("error", "Cannot check, must call or raise");
        }
        break;
      case "call":
        const callAmount = table.currentBet - player.currentBet;
        if (player.chips < callAmount) {
          return socket.emit("error", "Insufficient chips to call");
        }
        update.chips = player.chips - callAmount;
        update.currentBet = table.currentBet;
        tableUpdate.$inc = { pot: callAmount };
        break;
      case "raise":
        if (!amount || amount <= table.currentBet) {
          return socket.emit("error", "Invalid raise amount");
        }
        const raiseAmount = amount - player.currentBet;
        if (player.chips < raiseAmount) {
          return socket.emit("error", "Insufficient chips to raise");
        }
        update.chips = player.chips - raiseAmount;
        update.currentBet = amount;
        tableUpdate.currentBet = amount;
        tableUpdate.$inc = { pot: raiseAmount };
        await Player.updateMany({ table: tableId, _id: { $ne: player._id } }, { hasActed: false });
        break;
      case "allin":
        const allInAmount = player.chips;
        update.chips = 0;
        update.currentBet = player.currentBet + allInAmount;
        tableUpdate.$inc = { pot: allInAmount };
        if (update.currentBet > table.currentBet) {
          tableUpdate.currentBet = update.currentBet;
          await Player.updateMany({ table: tableId, _id: { $ne: player._id } }, { hasActed: false });
        }
        break;
      default:
        return socket.emit("error", `Unknown action: ${action}`);
    }

    await Promise.all([
      Player.findOneAndUpdate({ _id: player._id, table: tableId }, update, { new: true }),
      tableUpdate.$inc || tableUpdate.currentBet
        ? Table.findByIdAndUpdate(tableId, tableUpdate, { new: true })
        : Promise.resolve(),
    ]);

    await advanceTurn(tableId, io);
  } catch (error) {
    socket.emit("error", "Error processing action");
    console.error(error);
  }
};

export const handleDisconnect = (socket: Socket, io: Server, socketData: SocketData) => async () => {
  if (socketData.tableId && socketData.userId && mongoose.Types.ObjectId.isValid(socketData.userId)) {
    const player = await Player.findOneAndUpdate(
      { user: socketData.userId, table: socketData.tableId },
      { socketId: "" },
      { new: true }
    );
    if (player) {
      const updatedTable = await Table.findById(socketData.tableId)
        .populate("players")
        .populate("waitingPlayers")
        .lean();
      io.to(socketData.tableId).emit("tableUpdate", updatedTable);
      io.to(socketData.tableId).emit("playerDisconnected", player._id);
    }
  }
  console.log(`User disconnected: ${socket.id}`);
};