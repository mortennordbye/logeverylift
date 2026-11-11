import { Encoder, Profile } from "@garmin/fitsdk";
import { deflateRawSync } from "node:zlib";

/** A small FIT activity: 10 records a second apart with HR, distance and GPS, one session and two strength sets. */
export function buildFit(start = new Date("2026-11-04T06:00:00Z")): Buffer {
  const enc = new Encoder();
  enc.onMesg(Profile.MesgNum.FILE_ID, { manufacturer: "garmin", product: 0, timeCreated: start, type: "activity" });
  enc.onMesg(Profile.MesgNum.SPORT, { sport: "cycling", subSport: "indoorCycling" });
  for (let i = 0; i < 10; i++) {
    enc.onMesg(Profile.MesgNum.RECORD, {
      timestamp: new Date(start.getTime() + i * 1000),
      heartRate: 120 + i,
      distance: i * 8,
      // 59.9 deg N, 10.7 deg E in semicircles
      positionLat: Math.round((59.9 / 180) * 2 ** 31),
      positionLong: Math.round((10.7 / 180) * 2 ** 31),
    });
  }
  enc.onMesg(Profile.MesgNum.SET, { timestamp: start, duration: 30, repetitions: 5, weight: 100, setType: "active" });
  enc.onMesg(Profile.MesgNum.SET, { timestamp: start, duration: 90, setType: "rest" });
  enc.onMesg(Profile.MesgNum.SESSION, { timestamp: new Date(start.getTime() + 9000), startTime: start, totalElapsedTime: 9, sport: "cycling" });
  return Buffer.from(enc.close());
}

/** A ZIP with one deflated entry, like Garmin's activity download. */
export function buildZip(name: string, content: Buffer): Buffer {
  const data = deflateRawSync(content);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBuf.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, end]);
}
