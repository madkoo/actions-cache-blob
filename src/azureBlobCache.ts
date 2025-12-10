import * as cache from "@actions/cache";
import * as cacheUtils from "@actions/cache/lib/internal/cacheUtils";
import * as tar from "@actions/cache/lib/internal/tar";
import { DownloadOptions, UploadOptions } from "@actions/cache/lib/options";
import * as core from "@actions/core";
import {
    BlobServiceClient,
    ContainerClient,
    StorageSharedKeyCredential
} from "@azure/storage-blob";
import * as fs from "fs";
import * as path from "path";

import { AzureBlobConfig } from "./utils/actionUtils";

// Re-export isFeatureAvailable from @actions/cache
export { isFeatureAvailable } from "@actions/cache";

function getContainerClient(config: AzureBlobConfig): ContainerClient {
    let blobServiceClient: BlobServiceClient;

    if (config.connectionString) {
        // Use connection string if provided
        blobServiceClient = BlobServiceClient.fromConnectionString(
            config.connectionString
        );
    } else if (config.accountName && config.accountKey) {
        // Use account name and key
        const sharedKeyCredential = new StorageSharedKeyCredential(
            config.accountName,
            config.accountKey
        );
        const endpoint =
            config.endpoint ||
            `https://${config.accountName}.blob.core.windows.net`;
        blobServiceClient = new BlobServiceClient(
            endpoint,
            sharedKeyCredential
        );
    } else if (config.accountName && config.sasToken) {
        // Use SAS token
        const endpoint =
            config.endpoint ||
            `https://${config.accountName}.blob.core.windows.net`;
        blobServiceClient = new BlobServiceClient(
            `${endpoint}?${config.sasToken}`
        );
    } else {
        throw new Error(
            "Azure Blob Storage configuration is incomplete. Please provide either a connection string, or account name with account key/SAS token."
        );
    }

    if (!config.containerName) {
        throw new Error("Azure Blob Storage container name is required.");
    }

    return blobServiceClient.getContainerClient(config.containerName);
}

export async function restoreCache(
    paths: string[],
    primaryKey: string,
    restoreKeys?: string[],
    options?: DownloadOptions,
    enableCrossOsArchive?: boolean,
    azureConfig?: AzureBlobConfig,
    containerName?: string
): Promise<string | undefined> {
    // If no Azure config, fall back to default cache behavior
    if (!azureConfig || !containerName) {
        return cache.restoreCache(
            paths,
            primaryKey,
            restoreKeys,
            options,
            enableCrossOsArchive
        );
    }

    try {
        const containerClient = getContainerClient(azureConfig);

        // Try to find cache with primary key first
        let cacheKey = primaryKey;
        let blobClient = containerClient.getBlobClient(cacheKey);

        let exists = await blobClient.exists();

        // If primary key doesn't exist, try restore keys
        if (!exists && restoreKeys && restoreKeys.length > 0) {
            for (const restoreKey of restoreKeys) {
                blobClient = containerClient.getBlobClient(restoreKey);
                exists = await blobClient.exists();
                if (exists) {
                    cacheKey = restoreKey;
                    break;
                }
            }
        }

        if (!exists) {
            core.info(
                `Cache not found for input keys: ${[
                    primaryKey,
                    ...(restoreKeys || [])
                ].join(", ")}`
            );
            return undefined;
        }

        // If lookup only, don't download
        if (options?.lookupOnly) {
            core.info(
                `Cache found but not downloaded (lookup-only mode): ${cacheKey}`
            );
            return cacheKey;
        }

        // Download the cache file
        const archivePath = path.join(
            process.env["RUNNER_TEMP"] || "/tmp",
            `cache-${Date.now()}.tar`
        );

        core.info(`Downloading cache from Azure Blob Storage: ${cacheKey}`);
        await blobClient.downloadToFile(archivePath);

        // Extract the archive
        const compressionMethod = await cacheUtils.getCompressionMethod();
        await tar.extractTar(archivePath, compressionMethod);

        // Clean up the downloaded archive
        fs.unlinkSync(archivePath);

        core.info(`Cache restored from key: ${cacheKey}`);
        return cacheKey;
    } catch (error) {
        core.warning(
            `Failed to restore cache from Azure Blob Storage: ${
                (error as Error).message
            }`
        );
        return undefined;
    }
}

export async function saveCache(
    paths: string[],
    key: string,
    options?: UploadOptions,
    enableCrossOsArchive?: boolean,
    azureConfig?: AzureBlobConfig,
    containerName?: string
): Promise<number> {
    // If no Azure config, fall back to default cache behavior
    if (!azureConfig || !containerName) {
        return cache.saveCache(paths, key, options, enableCrossOsArchive);
    }

    try {
        const containerClient = getContainerClient(azureConfig);

        // Create cache archive
        const archiveFolder = path.join(
            process.env["RUNNER_TEMP"] || "/tmp",
            "cache"
        );
        const archivePath = path.join(archiveFolder, `cache.tar`);

        // Ensure archive folder exists
        if (!fs.existsSync(archiveFolder)) {
            fs.mkdirSync(archiveFolder, { recursive: true });
        }

        const compressionMethod = await cacheUtils.getCompressionMethod();
        core.info(
            `Creating cache archive with compression method: ${compressionMethod}`
        );

        await tar.createTar(archiveFolder, paths, compressionMethod);

        // Upload to Azure Blob Storage
        core.info(`Uploading cache to Azure Blob Storage with key: ${key}`);
        const blockBlobClient = containerClient.getBlockBlobClient(key);

        // Get file stats for upload
        const stats = fs.statSync(archivePath);
        core.info(`Cache archive size: ${stats.size} bytes`);

        await blockBlobClient.uploadFile(archivePath, {
            blobHTTPHeaders: { blobContentType: "application/x-tar" },
            blockSize: options?.uploadChunkSize
        });

        // Clean up the archive
        fs.unlinkSync(archivePath);
        if (fs.existsSync(archiveFolder)) {
            fs.rmdirSync(archiveFolder);
        }

        core.info(`Cache saved with key: ${key}`);

        // Return a dummy cache ID (Azure doesn't provide one)
        return 1;
    } catch (error) {
        core.warning(
            `Failed to save cache to Azure Blob Storage: ${
                (error as Error).message
            }`
        );
        throw error;
    }
}
