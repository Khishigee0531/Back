import { Expo, ExpoPushMessage } from "expo-server-sdk";

let expo = new Expo();

async function sendNotifications(
  tokens: string[],
  message: string,
  title: string
) {
  let validTokens = tokens.filter((token) => {
    if (!Expo.isExpoPushToken(token)) {
      console.warn(`Push token ${token} is not a valid Expo push token`);
      return false;
    }
    return true;
  });

  let messages: ExpoPushMessage[] = validTokens.map((token) => ({
    to: token,
    sound: "default",
    body: message,
    data: { withSome: "data" },
    title,
  }));

  let chunks = expo.chunkPushNotifications(messages);
  let tickets = [];

  for (let chunk of chunks) {
    try {
      let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error("Error sending notification chunk:", error);
    }
  }

  return tickets;
}

export default sendNotifications;
