import JSZip from "jszip";
import modelConfig from "./models";

type MaterialDefinition = {
  name: string;
  file?: string;
  fileSuffix?: string;
  hidden?: boolean;
  selectable?: boolean;
  optional?: boolean;
  frameCount?: number;
};

const materialMap: Record<string, MaterialDefinition[]> = modelConfig.materials;

const ignoreFilePattern = /^(\.|__MACOSX)/;

export const modelTypes = {
  player: [
    "lmale",
    "mmale",
    "hmale",
    "lfemale",
    "mfemale",
    "hfemale",
    "lbioderm",
    "mbioderm",
    "hbioderm",
  ],
  weapon: [
    "disc",
    "chaingun",
    "grenade_launcher",
    "sniper",
    "plasmathrower",
    "energy",
    "shocklance",
    "elf",
    "missile",
    "mortar",
    "repair",
    "targeting",
    "mine",
  ],
  vehicle: [
    "vehicle_grav_scout",
    "vehicle_grav_tank",
    "vehicle_land_mpbbase",
    "vehicle_air_scout",
    "vehicle_air_bomber",
    "vehicle_air_hapc",
  ],
};

export function modelToModelType(modelName: string) {
  switch (modelName) {
    case "lmale":
    case "mmale":
    case "hmale":
    case "lfemale":
    case "mfemale":
    case "hfemale":
    case "lbioderm":
    case "mbioderm":
    case "hbioderm":
      return "player";
    case "disc":
    case "chaingun":
    case "grenade_launcher":
    case "sniper":
    case "plasmathrower":
    case "energy":
    case "shocklance":
    case "elf":
    case "missile":
    case "mortar":
    case "repair":
    case "targeting":
    case "mine":
      return "weapon";
    case "vehicle_grav_scout":
    case "vehicle_grav_tank":
    case "vehicle_land_mpbbase":
    case "vehicle_air_scout":
    case "vehicle_air_bomber":
    case "vehicle_air_hapc":
      return "vehicle";
    default:
      throw new Error("Unknown model");
  }
}

export async function readZipFile(inputFile: File) {
  const content = await JSZip.loadAsync(inputFile);
  const skins = await Promise.all(
    Object.entries(content.files).map(async ([path, file]) => {
      if (!ignoreFilePattern.test(path)) {
        const match = /\.png$/i.exec(path);
        if (match) {
          const base64string = await file.async("base64");
          return {
            path,
            imageUrl: `data:image/png;base64,${base64string}`,
          };
        }
      }
    })
  );
  return skins.filter((x): x is NonNullable<typeof x> => Boolean(x));
}

type SkinManifestLayer = {
  filename: string;
  layerIndex: number;
  left: number;
  top: number;
  angle: number;
  scaleX: number;
  scaleY: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
};

type SkinManifestFrame = {
  materialName: string;
  frameIndex: number;
  filename: string;
  layers: SkinManifestLayer[];
};

type SkinManifest = {
  version: number;
  modelType: string;
  modelName: string;
  skinName: string;
  sizeMultiplier: number;
  canvasType: "color";
  materials: SkinManifestFrame[];
};

export type SkinLayerImageMap = Record<number, string>;

export type SkinArchiveEntry = {
  path: string;
  name: string | null;
  imageUrl: string;
  materialName?: string;
  modelName?: string;
  frameIndex?: number;
  layers?: SkinManifestLayer[];
  layerImageUrls?: SkinLayerImageMap;
  manifest?: SkinManifest;
};

export async function readSkinFile(inputFile: File) {
  console.debug("[skin-import] readSkinFile start", {
    fileName: inputFile.name,
    size: inputFile.size,
  });

  const content = await JSZip.loadAsync(inputFile);
  const manifestFile = content.file("skin.json");
  if (!manifestFile) {
    console.debug("[skin-import] readSkinFile missing skin.json", {
      fileName: inputFile.name,
    });
    return [] as SkinArchiveEntry[];
  }

  const manifest = JSON.parse(await manifestFile.async("string")) as SkinManifest;
  console.debug("[skin-import] manifest parsed", {
    fileName: inputFile.name,
    modelName: manifest.modelName,
    skinName: manifest.skinName,
    materialCount: manifest.materials?.length ?? 0,
  });

  const skinName = manifest.skinName || inputFile.name.replace(/\.skin$/i, "");
  const images = await Promise.all(
    (manifest.materials ?? []).map(async (materialFrame) => {
      const filePath = materialFrame.filename;
      const zipEntry =
        content.file(filePath) ??
        content.file(`textures/skins/${filePath}`) ??
        content.file(filePath.replace(/^textures\/skins\//, ""));
      if (!zipEntry) {
        console.debug("[skin-import] missing archive entry", {
          fileName: inputFile.name,
          filePath,
          materialName: materialFrame.materialName,
          frameIndex: materialFrame.frameIndex,
        });
        return null;
      }

      const base64string = await zipEntry.async("base64");
      const orderedLayers = [...(materialFrame.layers ?? [])].sort(
        (a, b) => a.layerIndex - b.layerIndex
      );
      const layerImageUrls: SkinLayerImageMap = {};

      for (const layer of orderedLayers) {
        const layerEntry =
          content.file(layer.filename) ??
          content.file(`textures/skins/${layer.filename}`) ??
          content.file(layer.filename.replace(/^textures\/skins\//, ""));

        if (!layerEntry) {
          console.debug("[skin-import] missing layer entry", {
            fileName: inputFile.name,
            materialName: materialFrame.materialName,
            frameIndex: materialFrame.frameIndex,
            layerFilename: layer.filename,
            layerIndex: layer.layerIndex,
          });
          continue;
        }

        const layerBase64 = await layerEntry.async("base64");
        layerImageUrls[layer.layerIndex] = `data:image/png;base64,${layerBase64}`;
      }

      const entry = {
        path: `${inputFile.name}/${filePath}`,
        name: skinName,
        imageUrl: `data:image/png;base64,${base64string}`,
        materialName: materialFrame.materialName,
        modelName: manifest.modelName,
        frameIndex: materialFrame.frameIndex,
        layers: orderedLayers,
        layerImageUrls,
        manifest,
      } satisfies SkinArchiveEntry;

      console.debug("[skin-import] archive frame decoded", {
        fileName: inputFile.name,
        materialName: materialFrame.materialName,
        frameIndex: materialFrame.frameIndex,
        filePath,
        layerCount: orderedLayers.length,
        layerImageCount: Object.keys(layerImageUrls).length,
      });

      return entry;
    })
  );

  const validImages = images.filter(
    (image): image is NonNullable<typeof image> => image != null
  );
  console.debug("[skin-import] readSkinFile complete", {
    fileName: inputFile.name,
    entryCount: validImages.length,
  });

  return validImages;
}

export function detectFileType(file: File) {
  if (file.name.match(/\.png$/i)) {
    return "png";
  } else if (file.name.match(/\.zip$/i)) {
    return "zip";
  } else if (file.name.match(/\.vl2$/i)) {
    return "vl2";
  } else if (file.name.match(/\.skin$/i)) {
    return "skin";
  }
}

export async function readImageFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", (event) => {
      if (typeof event.target?.result === "string") {
        resolve(event.target.result);
      } else {
        reject();
      }
    });
    reader.addEventListener("error", (event) => {
      reject();
    });
    reader.readAsDataURL(file);
  });
}

export async function readMultipleFiles(fileList: FileList | File[]) {
  const files = await Promise.all(
    Array.from(fileList).map(async (file) => {
      if (ignoreFilePattern.test(file.name)) {
        return null;
      }
      const fileType = detectFileType(file);
      switch (fileType) {
        case "zip":
        case "vl2": {
          const match = file.name.match(/^(.+)\.(zip|vl2)$/i);
          const name = match ? match[1] : file.name;
          return (await readZipFile(file)).map(
            (imageFile: { path: string; imageUrl: string }) => ({
              ...imageFile,
              path: `${file.name}/${imageFile.path}`,
              name,
            })
          );
        }
        case "png":
          return {
            path: file.name,
            imageUrl: await readImageFile(file),
            name: null,
          };
        case "skin": {
          return (await readSkinFile(file)).map((imageFile) => ({
            ...imageFile,
            path: `${file.name}/${imageFile.path.split("/").slice(-1)[0]}`,
          }));
        }
        default:
          return null;
      }
    })
  );
  return files.flat().filter((x): x is NonNullable<typeof x> => Boolean(x));
}

function createReverseFileMap() {
  const map = new Map();
  for (const modelName in materialMap) {
    materialMap[modelName].forEach((material, i) => {
      let filename;
      if (material.fileSuffix) {
        filename = material.fileSuffix;
      } else if (
        material.selectable !== false &&
        material.hidden !== true &&
        (material.file || material.name)
      ) {
        filename = material.file || material.name;
      }
      if (filename) {
        const models = map.get(filename) ?? [];
        models.push({ modelName, material, index: i });
        map.set(filename, models);
      }
    });
  }
  return map;
}

let pathToModelMap: Map<
  string,
  Array<{
    modelName: string;
    material: MaterialDefinition;
    index: number;
    frameIndex?: number;
  }>
>;

function getFrameInfo(nameWithoutExtension: string) {
  const match = /^(.+[^\d])(\d{2,})$/.exec(nameWithoutExtension);
  if (match) {
    const head = match[1];
    const tail = match[2];
    const frameIndex = parseInt(tail, 10);
    const frameZeroFile = `${head}${"0".padStart(tail.length, "0")}`;
    const models = pathToModelMap.get(frameZeroFile) ?? [];
    return models
      .filter((model) => typeof model.material.frameCount === "number")
      .map((model) => {
        return {
          ...model,
          frameIndex,
        };
      });
  }
  return [];
}

function pathToModels(path: string, skinName: string | null = null) {
  if (!pathToModelMap) {
    pathToModelMap = createReverseFileMap();
  }
  const basename = path.split("/").slice(-1)[0];
  const match = basename.match(/^(.+)\.(PNG|png)$/);
  if (match) {
    const nameWithoutExtension = match[1];
    const parts = nameWithoutExtension.split(".");
    if (parts.length > 1) {
      const key = `.${parts[parts.length - 1]}`;
      const models = pathToModelMap.get(key);
      if (models) {
        return {
          path,
          basename,
          nameWithoutExtension,
          extension: match[2],
          skinName: parts.slice(0, parts.length - 1).join("."),
          models,
        };
      }
    } else {
      const frameInfo = getFrameInfo(parts[0]);
      if (frameInfo.length) {
        return {
          path,
          basename,
          nameWithoutExtension,
          extension: match[2],
          skinName,
          models: frameInfo,
        };
      } else {
        const models = pathToModelMap.get(parts[0]);
        if (models) {
          return {
            path,
            basename,
            nameWithoutExtension,
            extension: match[2],
            skinName,
            models,
          };
        }
      }
    }
  }
  return null;
}

export type Skin = {
  name: string | null;
  isComplete: null | boolean;
  materials: Map<string, string[]>;
  layers?: SkinManifestLayer[];
  layerImageUrls?: SkinLayerImageMap;
  layersByMaterial?: Map<string, Map<number, SkinManifestLayer[]>>;
  layerImageUrlsByMaterial?: Map<string, Map<number, SkinLayerImageMap>>;
};

function resolveMaterialDefinition(modelName: string, materialName: string) {
  return (
    materialMap[modelName]?.find(
      (material) =>
        material.name === materialName ||
        material.file === materialName ||
        material.fileSuffix === materialName
    ) ?? {
      name: materialName,
      file: materialName,
    }
  );
}

export function fileArrayToModels(files: SkinArchiveEntry[]) {
  console.debug("[skin-import] fileArrayToModels start", {
    fileCount: files.length,
    sample: files.slice(0, 3).map((file) => ({
      fileName: file.name,
      materialName: file.materialName,
      modelName: file.modelName,
      frameIndex: file.frameIndex,
      layerCount: file.layers?.length ?? 0,
    })),
  });

  const foundModels: Map<string, Map<string | null, Skin>> = new Map();

  files.forEach((file) => {
    const explicitModelName = file.modelName ?? file.manifest?.modelName;
    const explicitSkinName = file.name ?? file.manifest?.skinName ?? null;
    const explicitMaterialName = file.materialName;

    const explicitModels =
      explicitModelName && explicitMaterialName
        ? [
            {
              modelName: explicitModelName,
              material: resolveMaterialDefinition(
                explicitModelName,
                explicitMaterialName
              ),
              index: 0,
              frameIndex: file.frameIndex ?? 0,
            },
          ]
        : [];

    const fallbackInfo = explicitModels.length ? null : pathToModels(file.path, file.name);
    const resolvedSkinName = explicitSkinName ?? fallbackInfo?.skinName ?? null;
    const models = explicitModels.length ? explicitModels : fallbackInfo?.models ?? [];

    if (!models.length) {
      return;
    }

    models.forEach((model) => {
      const skinsByName: Map<string | null, Skin> =
        foundModels.get(model.modelName) ?? new Map();
      const key = model.material.file ?? model.material.name;
      const skinMaterials: Skin =
        skinsByName.get(resolvedSkinName) ?? {
          name: resolvedSkinName,
          isComplete: null,
          materials: new Map(),
          layers: file.layers
            ? [...file.layers].sort((a, b) => a.layerIndex - b.layerIndex)
            : undefined,
          layerImageUrls: file.layerImageUrls,
          layersByMaterial: new Map(),
          layerImageUrlsByMaterial: new Map(),
        };
      if (file.layers) {
        const orderedLayers = [...file.layers].sort(
          (a, b) => a.layerIndex - b.layerIndex
        );
        skinMaterials.layers = orderedLayers;
        skinMaterials.layersByMaterial =
          skinMaterials.layersByMaterial ?? new Map();
        const materialLayerMap = skinMaterials.layersByMaterial.get(key) ?? new Map();
        materialLayerMap.set(model.frameIndex ?? 0, orderedLayers);
        skinMaterials.layersByMaterial.set(key, materialLayerMap);
      }
      if (file.layerImageUrls) {
        skinMaterials.layerImageUrls = {
          ...(skinMaterials.layerImageUrls ?? {}),
          ...file.layerImageUrls,
        };
        skinMaterials.layerImageUrlsByMaterial =
          skinMaterials.layerImageUrlsByMaterial ?? new Map();
        const materialImageMap =
          skinMaterials.layerImageUrlsByMaterial.get(key) ?? new Map();
        materialImageMap.set(model.frameIndex ?? 0, file.layerImageUrls);
        skinMaterials.layerImageUrlsByMaterial.set(key, materialImageMap);
      }
      const materialFrames = skinMaterials.materials.get(key) ?? [];
      materialFrames[model.frameIndex ?? 0] = file.imageUrl;
      skinMaterials.materials.set(key, materialFrames);
      skinsByName.set(resolvedSkinName, skinMaterials);
      foundModels.set(model.modelName, skinsByName);

      console.debug("[skin-import] mapped file to model/material", {
        modelName: model.modelName,
        skinName: resolvedSkinName,
        materialKey: key,
        frameIndex: model.frameIndex ?? 0,
        layerCount: file.layers?.length ?? 0,
      });
    });
  });

  foundModels.forEach((skinsByName, modelName) => {
    const requiredMaterials = materialMap[modelName].filter(
      (material) =>
        material.selectable !== false &&
        material.hidden !== true &&
        material.optional !== true
    );
    skinsByName.forEach((skin) => {
      skin.isComplete = requiredMaterials.every((material) =>
        skin.materials.has(material.file ?? material.name)
      );
    });
  });

  return foundModels;
}

export async function importMultipleFilesToModels(fileList: FileList | File[]) {
  const imageFiles = await readMultipleFiles(fileList);
  return fileArrayToModels(imageFiles);
}
