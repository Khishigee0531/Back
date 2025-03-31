import mongoose, { Document, Schema } from 'mongoose';
import { IUser } from './Users';
export interface IMessage {
  user: mongoose.Types.ObjectId | IUser;
  content: string;
  timestamp: Date;
}

export interface IMessage {
  user: mongoose.Types.ObjectId | IUser;
  content: string;
  timestamp: Date;
}

export interface ITable {
  name: string;
  maxPlayers: number;
  buyIn: number;
  smallBlind: number;
  bigBlind: number;
  minimumBet: number;
  gameType: string;
  players: mongoose.Types.ObjectId[]; // Changed to store only ObjectId references
  waitingPlayers: mongoose.Types.ObjectId[]; // Changed to store only ObjectId references
  tableFee: number;
  status: 'waiting' | 'playing' | 'ended';
  communityCards: string[];
  pot: number;
  dealerSeat: number;
  currentPlayer: number;
  currentBet: number;
  round: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
  deck: string[];
  messages: IMessage[];
  tableEarnings: number;
}

interface Table extends ITable, Document {
  save(): Promise<this>;
}

const TableSchema: Schema = new Schema({
  tableFee: { type: Number, default: 0.02 }, // Changed to percentage (2%)
  tableEarnings: { type: Number, default: 0 },
  name: { type: String, required: false },
  maxPlayers: { type: Number, required: false },
  buyIn: { type: Number, required: false },
  smallBlind: { type: Number, required: false },
  bigBlind: { type: Number, required: false },
  minimumBet: { type: Number, required: false },
  gameType: { type: String, required: false },
  players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }], // Reference to Player
  waitingPlayers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }], // Reference to Player
  status: { type: String, default: 'waiting' },
  communityCards: [String],
  pot: { type: Number, default: 0 },
  dealerSeat: { type: Number, default: 0 },
  currentPlayer: { type: Number, default: 0 },
  currentBet: { type: Number, default: 0 },
  round: { type: String, default: 'preflop' },
  deck: { type: [String], default: [] },
  messages: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
    content: { type: String, required: false },
    timestamp: { type: Date, default: Date.now },
  }],
}, {
  versionKey: false,
});

export default mongoose.model<Table>('Table', TableSchema);