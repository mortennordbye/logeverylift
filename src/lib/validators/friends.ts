import { z } from "zod";

export const sendFriendRequestSchema = z.object({
  addresseeId: z.string().min(1),
});

export const respondToFriendRequestSchema = z.object({
  friendshipId: z.number().int().positive(),
  action: z.enum(["accepted", "declined"]),
});

export const removeFriendSchema = z.object({
  friendshipId: z.number().int().positive(),
});

export const searchUsersSchema = z.object({
  query: z.string().min(1).max(100).trim(),
});

export const shareProgramSchema = z.object({
  programId: z.number().int().positive(),
  friendUserId: z.string().min(1),
});

export const copySharedProgramSchema = z.object({
  shareId: z.number().int().positive(),
});

export const updateActivityPrivacySchema = z.object({
  showActivityToFriends: z.boolean(),
});

export const toggleReactionSchema = z.object({
  sessionId: z.number().int().positive(),
  emoji: z.enum(["🔥", "💪", "👏"]),
});

export const sendNudgeSchema = z.object({
  toUserId: z.string().min(1),
});
