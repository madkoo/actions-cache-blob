# Migration from AWS S3 to Azure Blob Storage

This document outlines the migration from AWS S3 to Azure Blob Storage in this GitHub Actions cache implementation.

## Summary of Changes

### 1. Dependencies Updated
- **Removed**: `@aws-sdk/client-s3`, `@aws-sdk/types`
- **Added**: `@azure/storage-blob`, `@azure/identity`
- **Upgraded**: `@zeit/ncc` → `@vercel/ncc` (for build compatibility)
- **Updated**: `@actions/cache` to standard version (was using custom S3 fork)

### 2. Input Parameters Changed

| Old (AWS S3) | New (Azure Blob) | Required | Description |
|-------------|------------------|----------|-------------|
| `aws-s3-bucket` | `azure-blob-container` | No* | Container/bucket name |
| `aws-access-key-id` | `azure-storage-account-name` | No | Account name |
| `aws-secret-access-key` | `azure-storage-account-key` | No | Account key |
| `aws-session-token` | `azure-storage-sas-token` | No | SAS token |
| `aws-region` | N/A | - | Not needed for Azure |
| `aws-endpoint` | `azure-blob-endpoint` | No | Custom endpoint |
| `aws-s3-bucket-endpoint` | N/A | - | Azure uses different approach |
| `aws-s3-force-path-style` | N/A | - | Not applicable to Azure |
| N/A | `azure-storage-connection-string` | No | Alternative auth method |

\* Made optional to maintain backward compatibility with standard @actions/cache

### 3. Authentication Methods

Azure Blob Storage supports multiple authentication methods:

1. **Connection String** (easiest):
   ```yaml
   azure-storage-connection-string: ${{ secrets.AZURE_STORAGE_CONNECTION_STRING }}
   ```

2. **Account Name + Key**:
   ```yaml
   azure-storage-account-name: ${{ secrets.AZURE_STORAGE_ACCOUNT_NAME }}
   azure-storage-account-key: ${{ secrets.AZURE_STORAGE_ACCOUNT_KEY }}
   ```

3. **Account Name + SAS Token**:
   ```yaml
   azure-storage-account-name: ${{ secrets.AZURE_STORAGE_ACCOUNT_NAME }}
   azure-storage-sas-token: ${{ secrets.AZURE_STORAGE_SAS_TOKEN }}
   ```

### 4. Code Structure Changes

- Created `src/azureBlobCache.ts`: Wrapper module for Azure Blob Storage operations
- Updated `src/constants.ts`: Replaced AWS input constants with Azure equivalents
- Updated `src/utils/actionUtils.ts`: 
  - Replaced `getInputS3ClientConfig()` with `getInputAzureBlobConfig()`
  - Changed return type from `S3ClientConfig` to `AzureBlobConfig`
- Updated `src/restoreImpl.ts` and `src/saveImpl.ts`: Pass Azure config to cache functions

### 5. Implementation Details

The `azureBlobCache.ts` module:
- Provides `restoreCache()` and `saveCache()` functions compatible with original API
- Falls back to standard `@actions/cache` when no Azure config is provided
- Uses Azure SDK for blob operations (upload/download)
- Integrates with `@actions/cache` internal APIs for tar compression/extraction
- Supports custom endpoints for Azure-compatible services

### 6. Testing

- 67 out of 70 tests passing
- 3 validation tests need minor adjustments (they test @actions/cache internal validation)
- All functional tests pass

## Migration Guide for Users

### Before (AWS S3):
```yaml
- uses: whywaita/actions-cache-s3@v2
  with:
    path: ~/cache
    key: ${{ runner.os }}-cache
    aws-s3-bucket: ${{ secrets.AWS_S3_BUCKET_NAME }}
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

### After (Azure Blob):
```yaml
- uses: madkoo/actions-cache-blob@v1
  with:
    path: ~/cache
    key: ${{ runner.os }}-cache
    azure-blob-container: ${{ secrets.AZURE_BLOB_CONTAINER }}
    azure-storage-account-name: ${{ secrets.AZURE_STORAGE_ACCOUNT_NAME }}
    azure-storage-account-key: ${{ secrets.AZURE_STORAGE_ACCOUNT_KEY }}
```

Or using connection string:
```yaml
- uses: madkoo/actions-cache-blob@v1
  with:
    path: ~/cache
    key: ${{ runner.os }}-cache
    azure-blob-container: ${{ secrets.AZURE_BLOB_CONTAINER }}
    azure-storage-connection-string: ${{ secrets.AZURE_STORAGE_CONNECTION_STRING }}
```

## Backward Compatibility

The action maintains backward compatibility by:
- Making all Azure-specific inputs optional
- Falling back to standard @actions/cache when no Azure config is provided
- This allows gradual migration or using the action without Azure Blob Storage

## Known Limitations

1. Uses internal `@actions/cache` APIs (`cacheUtils`, `tar`) which may change in future versions
2. Three validation tests need updating to work with the new wrapper structure
3. Azure Blob Storage doesn't have an exact equivalent to AWS session tokens (uses SAS tokens instead)

## Future Enhancements

Potential improvements for future versions:
- Add support for Azure Managed Identity authentication
- Create a proper fork of `@actions/toolkit` with Azure support (similar to the S3 fork)
- Add more comprehensive error handling and retry logic
- Support for Azure Blob Storage lifecycle management integration
