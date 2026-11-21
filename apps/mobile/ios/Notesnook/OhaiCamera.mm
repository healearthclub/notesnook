#import <AVFoundation/AVFoundation.h>
#import <AVKit/AVKit.h>
#import <Photos/Photos.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTViewManager.h>
#import <React/RCTUtils.h>

@interface OhaiCameraSession : NSObject <AVCapturePhotoCaptureDelegate>
@property (nonatomic, readonly) AVCaptureSession *session;
@property (nonatomic, readonly) dispatch_queue_t queue;
@property (nonatomic, strong) AVCapturePhotoOutput *output;
@property (nonatomic, copy) RCTPromiseResolveBlock resolveCapture;
@property (nonatomic, copy) RCTPromiseRejectBlock rejectCapture;
+ (instancetype)shared;
@end

@implementation OhaiCameraSession

+ (instancetype)shared
{
  static OhaiCameraSession *camera;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    camera = [OhaiCameraSession new];
  });
  return camera;
}

- (instancetype)init
{
  if ((self = [super init])) {
    _session = [AVCaptureSession new];
    _queue = dispatch_queue_create("org.healearth.ohai.camera", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (BOOL)configure
{
  if (self.output) return YES;

  AVCaptureDevice *device = [AVCaptureDevice defaultDeviceWithDeviceType:AVCaptureDeviceTypeBuiltInWideAngleCamera
                                                               mediaType:AVMediaTypeVideo
                                                                position:AVCaptureDevicePositionBack];
  if (!device) return NO;
  AVCaptureDeviceInput *input = [AVCaptureDeviceInput deviceInputWithDevice:device error:NULL];
  AVCapturePhotoOutput *output = [AVCapturePhotoOutput new];
  if (!input || ![self.session canAddInput:input]) return NO;

  [self.session beginConfiguration];
  self.session.sessionPreset = AVCaptureSessionPresetPhoto;
  [self.session addInput:input];
  BOOL ready = [self.session canAddOutput:output];
  if (ready) {
    [self.session addOutput:output];
    self.output = output;
    AVCaptureConnection *connection = [output connectionWithMediaType:AVMediaTypeVideo];
    if (connection.isVideoOrientationSupported) connection.videoOrientation = AVCaptureVideoOrientationPortrait;
  } else {
    [self.session removeInput:input];
  }
  [self.session commitConfiguration];
  return ready;
}

- (void)captureOutput:(AVCapturePhotoOutput *)output
    didFinishProcessingPhoto:(AVCapturePhoto *)photo
                        error:(NSError *)error
{
  NSData *data = photo.fileDataRepresentation;
  dispatch_async(self.queue, ^{
    NSError *failure = error;
    NSURL *file = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:
      [NSString stringWithFormat:@"ohai-photo-%@.jpg", NSUUID.UUID.UUIDString]]];
    if (!failure && data && [data writeToURL:file options:NSDataWritingAtomic error:&failure]) {
      self.resolveCapture(file.absoluteString);
    } else {
      self.rejectCapture(@"photo_capture_failed", failure.localizedDescription ?: @"Could not capture the photo.", failure);
    }
    self.resolveCapture = nil;
    self.rejectCapture = nil;
  });
}

@end

@interface OhaiCamera : NSObject <RCTBridgeModule>
@end

@implementation OhaiCamera

RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return NO; }

RCT_EXPORT_METHOD(requestAccess:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo]) {
    resolve(@"unavailable");
    return;
  }
  [AVCaptureDevice requestAccessForMediaType:AVMediaTypeVideo completionHandler:^(BOOL granted) {
    resolve(granted ? @"granted" : @"denied");
  }];
}

RCT_EXPORT_METHOD(setRunning:(BOOL)running
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  OhaiCameraSession *camera = [OhaiCameraSession shared];
  dispatch_async(camera.queue, ^{
    if (running) {
      if ([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo] != AVAuthorizationStatusAuthorized ||
          ![camera configure]) {
        resolve(@NO);
        return;
      }
      if (!camera.session.isRunning) [camera.session startRunning];
    } else if (camera.session.isRunning) {
      [camera.session stopRunning];
    }
    resolve(@(camera.session.isRunning));
  });
}

RCT_EXPORT_METHOD(takePhoto:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  OhaiCameraSession *camera = [OhaiCameraSession shared];
  dispatch_async(camera.queue, ^{
    if (!camera.session.isRunning || !camera.output || camera.resolveCapture) {
      reject(@"camera_not_ready", @"The camera is not ready.", nil);
      return;
    }
    camera.resolveCapture = resolve;
    camera.rejectCapture = reject;
    [camera.output capturePhotoWithSettings:[AVCapturePhotoSettings photoSettingsWithFormat:@{AVVideoCodecKey: AVVideoCodecTypeJPEG}] delegate:camera];
  });
}


RCT_EXPORT_METHOD(savePhoto:(NSString *)uri
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURL *file = [NSURL URLWithString:uri];
  [PHPhotoLibrary requestAuthorizationForAccessLevel:PHAccessLevelAddOnly handler:^(PHAuthorizationStatus status) {
    if (status != PHAuthorizationStatusAuthorized && status != PHAuthorizationStatusLimited) {
      reject(@"photo_access_denied", @"Allow Photos access in Settings to save pictures.", nil);
      return;
    }
    [PHPhotoLibrary.sharedPhotoLibrary performChanges:^{
      [[PHAssetCreationRequest creationRequestForAsset] addResourceWithType:PHAssetResourceTypePhoto fileURL:file options:nil];
    } completionHandler:^(BOOL success, NSError *error) {
      if (success) resolve(@YES);
      else reject(@"photo_save_failed", error.localizedDescription ?: @"Could not save the photo.", error);
    }];
  }];
}

RCT_EXPORT_METHOD(discardPhoto:(NSString *)uri)
{
  NSURL *file = [NSURL URLWithString:uri];
  if (file.isFileURL &&
      [file.URLByDeletingLastPathComponent.path isEqualToString:[NSTemporaryDirectory() stringByStandardizingPath]] &&
      [file.lastPathComponent hasPrefix:@"ohai-photo-"]) {
    [NSFileManager.defaultManager removeItemAtURL:file error:NULL];
  }
}

RCT_EXPORT_METHOD(listAlbums:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  PHFetchResult<PHAssetCollection *> *collections =
    [PHAssetCollection fetchAssetCollectionsWithType:PHAssetCollectionTypeAlbum
                                            subtype:PHAssetCollectionSubtypeAny options:nil];
  NSMutableArray *albums = [NSMutableArray new];
  [collections enumerateObjectsUsingBlock:^(PHAssetCollection *album, NSUInteger index, BOOL *stop) {
    NSUInteger count = [PHAsset fetchAssetsInAssetCollection:album options:nil].count;
    [albums addObject:@{
      @"id": album.localIdentifier,
      @"title": album.localizedTitle ?: @"Untitled album",
      @"count": @(count)
    }];
  }];
  resolve(albums);
}

RCT_EXPORT_METHOD(getAlbumPage:(NSString *)albumID offset:(NSInteger)offset
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  PHAssetCollection *album = [PHAssetCollection fetchAssetCollectionsWithLocalIdentifiers:@[albumID] options:nil].firstObject;
  if (!album) {
    reject(@"album_unavailable", @"This album is unavailable.", nil);
    return;
  }
  PHFetchOptions *options = [PHFetchOptions new];
  options.predicate = [NSPredicate predicateWithFormat:@"mediaType == %d OR mediaType == %d",
                       PHAssetMediaTypeImage, PHAssetMediaTypeVideo];
  options.sortDescriptors = @[[NSSortDescriptor sortDescriptorWithKey:@"creationDate" ascending:NO]];
  PHFetchResult<PHAsset *> *assets = [PHAsset fetchAssetsInAssetCollection:album options:options];
  NSUInteger start = MIN((NSUInteger)MAX(0, offset), assets.count);
  NSUInteger end = MIN(start + 48, assets.count);
  NSMutableArray *items = [NSMutableArray arrayWithCapacity:end - start];
  for (NSUInteger i = start; i < end; i++) {
    PHAsset *asset = [assets objectAtIndex:i];
    [items addObject:@{
      @"node": @{
        @"id": asset.localIdentifier,
        @"type": asset.mediaType == PHAssetMediaTypeVideo ? @"video" : @"image",
        @"image": @{
          @"uri": [@"ph://" stringByAppendingString:asset.localIdentifier],
          @"playableDuration": @(asset.duration)
        }
      }
    }];
  }
  resolve(@{@"items": items, @"nextOffset": end < assets.count ? @(end) : NSNull.null});
}

RCT_EXPORT_METHOD(playVideo:(NSString *)assetID
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  PHAsset *asset = [PHAsset fetchAssetsWithLocalIdentifiers:@[assetID] options:nil].firstObject;
  if (!asset || asset.mediaType != PHAssetMediaTypeVideo) {
    reject(@"video_unavailable", @"The video is unavailable.", nil);
    return;
  }
  PHVideoRequestOptions *options = [PHVideoRequestOptions new];
  options.networkAccessAllowed = YES;
  [PHImageManager.defaultManager requestPlayerItemForVideo:asset options:options resultHandler:^(AVPlayerItem *item, NSDictionary *info) {
    dispatch_async(dispatch_get_main_queue(), ^{
      UIViewController *parent = RCTPresentedViewController();
      if (!item || !parent) {
        reject(@"video_unavailable", @"Could not open the video.", info[PHImageErrorKey]);
        return;
      }
      AVPlayerViewController *controller = [AVPlayerViewController new];
      controller.player = [AVPlayer playerWithPlayerItem:item];
      [parent presentViewController:controller animated:YES completion:^{
        [controller.player play];
        resolve(nil);
      }];
    });
  }];
}

@end

@interface OhaiCameraPreviewView : UIView
@end

@implementation OhaiCameraPreviewView

+ (Class)layerClass { return AVCaptureVideoPreviewLayer.class; }

- (instancetype)initWithFrame:(CGRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    AVCaptureVideoPreviewLayer *preview = (AVCaptureVideoPreviewLayer *)self.layer;
    preview.videoGravity = AVLayerVideoGravityResizeAspectFill;
    preview.session = [OhaiCameraSession shared].session;
  }
  return self;
}

@end

@interface OhaiCameraPreviewManager : RCTViewManager
@end

@implementation OhaiCameraPreviewManager

RCT_EXPORT_MODULE(OhaiCameraPreview);
+ (BOOL)requiresMainQueueSetup { return YES; }
- (UIView *)view { return [OhaiCameraPreviewView new]; }

@end
