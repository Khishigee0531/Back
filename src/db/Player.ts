import mongoose, { Schema, Document } from "mongoose";
export interface IPlayer extends Document {
  user: mongoose.Types.ObjectId; // Reference to User
  table: mongoose.Types.ObjectId; // Reference to Table
  socketId?: string; // Optional socket ID for real-time tracking
  seat: number; // Player's seat at the table
  chips: number; // Current chip count
  cards: [string, string] | [string, string, string, string]; // Player's hole cards
  username: string; // Display name
  inHand: boolean; // Whether the player is still in the current hand
  currentBet: number; // Current bet amount in the round
  hasActed: boolean; // Whether the player has acted in the current betting round
  consecutiveAfkRounds: number; // Number of consecutive rounds the player has been inactive
}

export const PlayerSchema: Schema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  table: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Table",
    required: true, // Link to the table the player is at
  },
  socketId: {
    type: String,
    default: null, // Optional, null if not connected
  },
  seat: {
    type: Number,
    required: false,
  },
  chips: {
    type: Number,
    required: false,
    min: 0, // Ensure chips can't go negative
  },
  cards: {
    type: [String], // Array of exactly 2 strings for Texas Hold'em

  },
  username: {
    type: String,
    required: false,
    trim: true, // Remove unnecessary whitespace
  },
  inHand: {
    type: Boolean,
    default: false, // Default to not in hand until game starts
  },
  currentBet: {
    type: Number,
    default: 0,
    min: 0, // Ensure bet can't be negative
  },
  hasActed: {
    type: Boolean,
    default: false, // Default to not acted
  },
  consecutiveAfkRounds: {
    type: Number,
    default: 0,
    min: 0, // Ensure non-negative
  },
}, {
  timestamps: true, // Add createdAt and updatedAt fields for tracking
  versionKey: false,
});

export const Player = mongoose.model<IPlayer>("Player", PlayerSchema);