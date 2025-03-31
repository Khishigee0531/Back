import { encode } from "blurhash";
import sharp from "sharp";
import gm from "gm";

export const setBlurHash = async (buffer: string) => {
  if (!buffer) {
    return null;
  }

  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });

  const uint8Data = new Uint8ClampedArray(data);
  const blurHash = encode(uint8Data, info.width, info.height, 4, 3);
  return blurHash;
};

export const gmSize = async (file: any) => {
  const im = gm.subClass({ imageMagick: true });
  const buffer = file.buffer;
  return new Promise((resolve, reject) => {
    (typeof buffer === "string" ? im(buffer) : im(buffer)).size((err, size) => {
      if (err) return reject(err);

      const width = size.width;
      const height = size.height;

      resolve({
        width,
        height,
      });
    });
  });
};

export const gmResize = (buffer:any, size: number) => {
  return new Promise((resolve, reject) => {
    const im = gm.subClass({ imageMagick: true });

    (typeof buffer === "string" ? im(buffer) : im(buffer))
      .autoOrient()
      .resize(size)
      .noProfile()
      .toBuffer("JPG", (err: any, buffer: any) => {
        if (err) return reject(err);

        resolve(buffer);
      });
  });
};
export const createThumbnail = async (file: any) => {
  if (!file) {
    return null;
  }

  const { data, info } = await sharp(file)
    .raw()
    .resize({ fit: "cover" })
    .toFormat("png")
    .png({ quality: 100 })
    .toBuffer({ resolveWithObject: true });
  // const pixelArray = new Uint8ClampedArray(data);
  // console.log("pixelArray", pixelArray);
  // const { width, height, channels } = info;
  // const img = await sharp(pixelArray, {
  //   raw: { width, height, channels },
  // }).toFile("my-changed-image.jpg");
  // console.log("img", img);
  return data;
};
