#import <AVFoundation/AVFoundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface OhaiMusicPlayer : RCTEventEmitter <RCTBridgeModule>
@property (nonatomic, strong) AVPlayer *player;
@property (nonatomic, strong) NSNumber *requestId;
@property (nonatomic) BOOL hasListeners;
@property (nonatomic) BOOL ended;
@end

@implementation OhaiMusicPlayer

RCT_EXPORT_MODULE(OhaiMusicPlayer)

- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"OhaiMusicState"]; }
- (void)startObserving { self.hasListeners = YES; }
- (void)stopObserving { self.hasListeners = NO; }

- (void)clearPlayer
{
  if (!self.player) return;
  [self.player removeObserver:self forKeyPath:@"timeControlStatus"];
  [self.player.currentItem removeObserver:self forKeyPath:@"status"];
  [NSNotificationCenter.defaultCenter removeObserver:self name:nil object:self.player.currentItem];
  [self.player pause];
  self.player = nil;
  self.requestId = nil;
  self.ended = NO;
}

- (void)invalidate
{
  self.hasListeners = NO;
  [self clearPlayer];
  [super invalidate];
}

- (void)emitState
{
  if (!self.hasListeners || !self.requestId || !self.player) return;
  NSString *state = @"loading";
  if (self.player.currentItem.status == AVPlayerItemStatusFailed ||
      self.player.status == AVPlayerStatusFailed) state = @"failed";
  else if (self.ended) state = @"ended";
  else if (self.player.timeControlStatus == AVPlayerTimeControlStatusPlaying) state = @"playing";
  else if (self.player.currentItem.status == AVPlayerItemStatusReadyToPlay &&
           self.player.timeControlStatus == AVPlayerTimeControlStatusPaused) state = @"paused";
  [self sendEventWithName:@"OhaiMusicState" body:@{ @"requestId": self.requestId, @"state": state }];
}

- (void)observeValueForKeyPath:(NSString *)path
                     ofObject:(id)object
                       change:(NSDictionary *)change
                      context:(void *)context
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (object == self.player || object == self.player.currentItem) [self emitState];
  });
}

- (void)itemEnded:(NSNotification *)notification
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (notification.object != self.player.currentItem) return;
    self.ended = YES;
    [self emitState];
  });
}

- (void)itemFailed:(NSNotification *)notification
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (notification.object != self.player.currentItem || !self.hasListeners || !self.requestId) return;
    [self sendEventWithName:@"OhaiMusicState" body:@{ @"requestId": self.requestId, @"state": @"failed" }];
    [self clearPlayer];
  });
}

RCT_EXPORT_METHOD(start:(NSString *)address
                  sessionToken:(NSString *)token
                  requestId:(NSNumber *)requestId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURL *url = [NSURL URLWithString:address];
  if (![url.scheme isEqualToString:@"https"] || url.host.length == 0 || url.user || url.password) {
    reject(@"invalid_audio", @"The audio address is invalid.", nil);
    return;
  }
  NSMutableDictionary *options = [NSMutableDictionary dictionary];
  if (token.length) {
    if (![url.host isEqualToString:@"healearth.club"] ||
        ![url.path isEqualToString:@"/ohai/auth/native/music/stream"] ||
        (url.port && url.port.integerValue != 443)) {
      reject(@"invalid_audio", @"The music stream address is invalid.", nil);
      return;
    }
    NSHTTPCookie *cookie = [NSHTTPCookie cookieWithProperties:@{
      NSHTTPCookieOriginURL: url,
      NSHTTPCookiePath: url.path,
      NSHTTPCookieName: @"__Secure-ohai-music",
      NSHTTPCookieValue: token,
      NSHTTPCookieSecure: @"TRUE",
      NSHTTPCookieDiscard: @"TRUE",
      @"HttpOnly": @"TRUE",
    }];
    if (!cookie) {
      reject(@"invalid_session", @"Could not prepare the music session.", nil);
      return;
    }
    options[AVURLAssetHTTPCookiesKey] = @[cookie];
  }
  options[AVURLAssetReferenceRestrictionsKey] = @(AVAssetReferenceRestrictionForbidAll);
  [self clearPlayer];

  AVAudioSession *audio = AVAudioSession.sharedInstance;
  NSError *error = nil;
  if (![audio setCategory:AVAudioSessionCategoryPlayback error:&error] ||
      ![audio setActive:YES error:&error]) {
    reject(@"audio_unavailable", @"Could not start audio playback.", error);
    return;
  }
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:options];
  AVPlayerItem *item = [AVPlayerItem playerItemWithAsset:asset];
  self.requestId = requestId;
  self.player = [AVPlayer playerWithPlayerItem:item];
  [item addObserver:self forKeyPath:@"status" options:NSKeyValueObservingOptionNew context:NULL];
  [self.player addObserver:self forKeyPath:@"timeControlStatus" options:NSKeyValueObservingOptionNew context:NULL];
  [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(itemEnded:) name:AVPlayerItemDidPlayToEndTimeNotification object:item];
  [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(itemFailed:) name:AVPlayerItemFailedToPlayToEndTimeNotification object:item];
  [self.player play];
  [self emitState];
  resolve(nil);
}

RCT_EXPORT_METHOD(setPaused:(BOOL)paused requestId:(NSNumber *)requestId)
{
  if (![self.requestId isEqualToNumber:requestId]) return;
  if (paused) {
    [self.player pause];
  } else {
    if (self.ended) {
      self.ended = NO;
      [self.player seekToTime:kCMTimeZero];
    }
    [self.player play];
  }
  [self emitState];
}

RCT_EXPORT_METHOD(stop)
{
  [self clearPlayer];
}

@end
