#import <AVFoundation/AVFoundation.h>
#import <MediaPlayer/MediaPlayer.h>
#import <UIKit/UIKit.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface OhaiMusicPlayer : RCTEventEmitter <RCTBridgeModule, NSURLSessionTaskDelegate, MPNowPlayingSessionDelegate>
@property (nonatomic, strong) AVPlayer *player;
@property (nonatomic, strong) NSNumber *requestId;
@property (nonatomic) BOOL hasListeners;
@property (nonatomic) BOOL ended;
@property (nonatomic, copy) NSDictionary *metadata;
@property (nonatomic, strong) MPMediaItemArtwork *artwork;
@property (nonatomic, strong) NSURLSession *artworkSession;
@property (nonatomic, strong) NSArray<MPRemoteCommand *> *remoteCommands;
@property (nonatomic, strong) MPNowPlayingSession *nowPlayingSession API_AVAILABLE(ios(16.0));
- (void)nowPlayingSessionDidChangeActive:(MPNowPlayingSession *)session API_AVAILABLE(ios(16.0));
- (void)nowPlayingSessionDidChangeCanBecomeActive:(MPNowPlayingSession *)session API_AVAILABLE(ios(16.0));
@end

@implementation OhaiMusicPlayer

RCT_EXPORT_MODULE(OhaiMusicPlayer)

- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"OhaiMusicState", @"OhaiMusicCommand"]; }
- (void)startObserving { self.hasListeners = YES; }
- (void)stopObserving { self.hasListeners = NO; }

- (void)clearPlayer
{
  [NSNotificationCenter.defaultCenter removeObserver:self name:UIApplicationDidBecomeActiveNotification object:nil];
  [NSNotificationCenter.defaultCenter removeObserver:self name:UIApplicationDidEnterBackgroundNotification object:nil];
  [self.artworkSession invalidateAndCancel];
  self.artworkSession = nil;
  self.metadata = nil;
  self.artwork = nil;
  if (self.player) [self musicInfoCenter].nowPlayingInfo = nil;
  for (MPRemoteCommand *command in self.remoteCommands) {
    command.enabled = NO;
    [command removeTarget:self];
  }
  self.remoteCommands = nil;
  if (@available(iOS 16.0, *)) {
    self.nowPlayingSession.delegate = nil;
    self.nowPlayingSession = nil;
  }
  if (!self.player) return;
  [self.player removeObserver:self forKeyPath:@"timeControlStatus"];
  [self.player.currentItem removeObserver:self forKeyPath:@"status"];
  [self.player.currentItem removeObserver:self forKeyPath:@"duration"];
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
  if (!self.requestId || !self.player) return;
  [self updateNowPlaying];
  if (!self.hasListeners) return;
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

- (BOOL)activateMusicAudioSession:(NSError **)error
{
  AVAudioSession *audio = AVAudioSession.sharedInstance;
  return [audio setCategory:AVAudioSessionCategoryPlayback mode:AVAudioSessionModeDefault
        routeSharingPolicy:AVAudioSessionRouteSharingPolicyLongFormAudio options:0 error:error] &&
         [audio setActive:YES error:error];
}

RCT_EXPORT_METHOD(start:(NSString *)address
                  sessionToken:(NSString *)token
                  requestId:(NSNumber *)requestId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [self prepareAddress:address token:token requestId:requestId paused:NO resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(prepare:(NSString *)address
                  sessionToken:(NSString *)token
                  requestId:(NSNumber *)requestId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [self prepareAddress:address token:token requestId:requestId paused:YES resolve:resolve reject:reject];
}

- (void)prepareAddress:(NSString *)address token:(NSString *)token requestId:(NSNumber *)requestId
                paused:(BOOL)paused resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
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
  NSError *error = nil;
  if (![self activateMusicAudioSession:&error]) {
    reject(@"audio_unavailable", @"Could not start audio playback.", error);
    return;
  }
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:options];
  AVPlayerItem *item = [AVPlayerItem playerItemWithAsset:asset];
  [self.artworkSession invalidateAndCancel];
  self.artworkSession = nil;
  self.metadata = nil;
  self.artwork = nil;
  self.ended = NO;
  self.requestId = requestId;
  if (self.player) {
    AVPlayerItem *previousItem = self.player.currentItem;
    [previousItem removeObserver:self forKeyPath:@"status"];
    [previousItem removeObserver:self forKeyPath:@"duration"];
    [NSNotificationCenter.defaultCenter removeObserver:self name:nil object:previousItem];
    // Keep the active media session and its last metadata during the handoff.
    // Clearing it here makes iOS flash its system "Not Playing" placeholder.
    self.player.allowsExternalPlayback = NO;
    [self.player replaceCurrentItemWithPlayerItem:item];
  } else {
    // This is an audio-only player. Keep authenticated asset loading and queue
    // ownership on the phone; AVAudioSession still routes audio over AirPlay.
    // External (video/remote-asset) playback can strand protected MP3s on the TV.
    self.player = [AVPlayer new];
    self.player.allowsExternalPlayback = NO;
    [self.player replaceCurrentItemWithPlayerItem:item];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(applicationPlaybackStateChanged:) name:UIApplicationDidBecomeActiveNotification object:nil];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(applicationPlaybackStateChanged:) name:UIApplicationDidEnterBackgroundNotification object:nil];
    [self.player addObserver:self forKeyPath:@"timeControlStatus" options:NSKeyValueObservingOptionNew context:NULL];
    if (@available(iOS 16.0, *)) {
      self.nowPlayingSession = [[MPNowPlayingSession alloc] initWithPlayers:@[self.player]];
      self.nowPlayingSession.automaticallyPublishesNowPlayingInfo = NO;
      self.nowPlayingSession.delegate = self;
    }
  }
  [item addObserver:self forKeyPath:@"status" options:NSKeyValueObservingOptionNew context:NULL];
  [item addObserver:self forKeyPath:@"duration" options:NSKeyValueObservingOptionNew context:NULL];
  [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(itemEnded:) name:AVPlayerItemDidPlayToEndTimeNotification object:item];
  [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(itemFailed:) name:AVPlayerItemFailedToPlayToEndTimeNotification object:item];
  if (!paused) [self.player play];
  [self emitState];
  resolve(nil);
}

- (MPNowPlayingInfoCenter *)musicInfoCenter
{
  if (@available(iOS 16.0, *)) {
    if (self.nowPlayingSession) return self.nowPlayingSession.nowPlayingInfoCenter;
  }
  return MPNowPlayingInfoCenter.defaultCenter;
}

- (MPRemoteCommandCenter *)musicCommandCenter
{
  if (@available(iOS 16.0, *)) {
    if (self.nowPlayingSession) return self.nowPlayingSession.remoteCommandCenter;
  }
  return MPRemoteCommandCenter.sharedCommandCenter;
}

- (void)claimMusicSession
{
  if (@available(iOS 16.0, *)) {
    MPNowPlayingSession *session = self.nowPlayingSession;
    if (self.metadata && self.player.timeControlStatus == AVPlayerTimeControlStatusPlaying &&
        !session.active && session.canBecomeActive) {
      [session becomeActiveIfPossibleWithCompletion:nil];
    }
  }
}

- (void)nowPlayingSessionDidChangeActive:(MPNowPlayingSession *)session
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (@available(iOS 16.0, *)) {
      if (session != self.nowPlayingSession) return;
      // Session ownership is not a playback command. iOS can change it during
      // foreground/background transitions; pausing here strands the music dock.
      // AVPlayer and audio-session interruptions remain the playback authority.
      if (session.active) [self updateNowPlaying];
    }
  });
}

- (void)nowPlayingSessionDidChangeCanBecomeActive:(MPNowPlayingSession *)session
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (@available(iOS 16.0, *)) {
      if (session == self.nowPlayingSession) [self claimMusicSession];
    }
  });
}

- (void)applicationPlaybackStateChanged:(NSNotification *)notification
{
  dispatch_async(dispatch_get_main_queue(), ^{
    // Refresh current metadata/elapsed time without restarting a paused song.
    // updateNowPlaying only claims ownership when audio is actually playing.
    [self updateNowPlaying];
  });
}

- (void)updateNowPlaying
{
  if (!self.metadata || !self.player) return;
  BOOL failed = self.player.currentItem.status == AVPlayerItemStatusFailed ||
                self.player.status == AVPlayerStatusFailed;
  if (failed) {
    [self musicInfoCenter].nowPlayingInfo = nil;
    for (MPRemoteCommand *command in self.remoteCommands) command.enabled = NO;
    return;
  }
  NSMutableDictionary *info = [@{
    MPMediaItemPropertyTitle: self.metadata[@"title"] ?: @"Untitled track",
    MPMediaItemPropertyArtist: self.metadata[@"artist"] ?: @"",
    MPNowPlayingInfoPropertyMediaType: @(MPNowPlayingInfoMediaTypeAudio),
    MPNowPlayingInfoPropertyIsLiveStream: @NO,
    MPNowPlayingInfoPropertyDefaultPlaybackRate: @1,
    MPNowPlayingInfoPropertyPlaybackRate: @(self.ended || self.player.timeControlStatus != AVPlayerTimeControlStatusPlaying ? 0 : self.player.rate),
    MPNowPlayingInfoPropertyPlaybackQueueCount: self.metadata[@"queueCount"] ?: @1,
    MPNowPlayingInfoPropertyPlaybackQueueIndex: self.metadata[@"queueIndex"] ?: @0
  } mutableCopy];
  double elapsed = CMTimeGetSeconds(self.player.currentTime);
  double duration = CMTimeGetSeconds(self.player.currentItem.duration);
  if (isfinite(elapsed)) info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @(MAX(0, elapsed));
  if (isfinite(duration) && duration > 0) info[MPMediaItemPropertyPlaybackDuration] = @(duration);
  if (self.artwork) info[MPMediaItemPropertyArtwork] = self.artwork;
  [self musicInfoCenter].nowPlayingInfo = info;

  MPRemoteCommandCenter *center = [self musicCommandCenter];
  center.playCommand.enabled = YES;
  center.pauseCommand.enabled = YES;
  center.togglePlayPauseCommand.enabled = YES;
  BOOL canSkip = self.hasListeners && [self.metadata[@"queueCount"] integerValue] > 1;
  center.nextTrackCommand.enabled = canSkip;
  center.previousTrackCommand.enabled = canSkip;
  center.changePlaybackPositionCommand.enabled = isfinite(duration) && duration > 0;
  [self claimMusicSession];
}

- (void)registerRemoteCommands
{
  if (self.remoteCommands) return;
  MPRemoteCommandCenter *center = [self musicCommandCenter];
  [center.playCommand addTarget:self action:@selector(remotePlay:)];
  [center.pauseCommand addTarget:self action:@selector(remotePause:)];
  [center.togglePlayPauseCommand addTarget:self action:@selector(remoteToggle:)];
  [center.nextTrackCommand addTarget:self action:@selector(remoteNext:)];
  [center.previousTrackCommand addTarget:self action:@selector(remotePrevious:)];
  [center.changePlaybackPositionCommand addTarget:self action:@selector(remoteSeek:)];
  self.remoteCommands = @[center.playCommand, center.pauseCommand,
    center.togglePlayPauseCommand, center.nextTrackCommand, center.previousTrackCommand,
    center.changePlaybackPositionCommand];
}

- (MPRemoteCommandHandlerStatus)remotePlay:(MPRemoteCommandEvent *)event
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.player) [self setPaused:NO requestId:self.requestId];
  });
  return MPRemoteCommandHandlerStatusSuccess;
}

- (MPRemoteCommandHandlerStatus)remotePause:(MPRemoteCommandEvent *)event
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.player) [self setPaused:YES requestId:self.requestId];
  });
  return MPRemoteCommandHandlerStatusSuccess;
}

- (MPRemoteCommandHandlerStatus)remoteToggle:(MPRemoteCommandEvent *)event
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.player) [self setPaused:self.player.rate > 0 requestId:self.requestId];
  });
  return MPRemoteCommandHandlerStatusSuccess;
}

- (void)sendRemoteTrackCommand:(NSString *)command
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!self.player || !self.hasListeners || !self.requestId) return;
    [self sendEventWithName:@"OhaiMusicCommand"
                      body:@{@"command": command, @"requestId": self.requestId}];
  });
}

- (MPRemoteCommandHandlerStatus)remoteNext:(MPRemoteCommandEvent *)event
{
  [self sendRemoteTrackCommand:@"next"];
  return MPRemoteCommandHandlerStatusSuccess;
}

- (MPRemoteCommandHandlerStatus)remotePrevious:(MPRemoteCommandEvent *)event
{
  [self sendRemoteTrackCommand:@"previous"];
  return MPRemoteCommandHandlerStatusSuccess;
}

- (MPRemoteCommandHandlerStatus)remoteSeek:(MPChangePlaybackPositionCommandEvent *)event
{
  NSTimeInterval position = event.positionTime;
  dispatch_async(dispatch_get_main_queue(), ^{
    double duration = CMTimeGetSeconds(self.player.currentItem.duration);
    if (!self.player || !isfinite(position) || !isfinite(duration) || duration <= 0) return;
    self.ended = NO;
    NSNumber *requestId = self.requestId;
    __weak OhaiMusicPlayer *weakSelf = self;
    [self.player seekToTime:CMTimeMakeWithSeconds(MAX(0, MIN(position, duration)), 600)
         completionHandler:^(BOOL finished) {
      dispatch_async(dispatch_get_main_queue(), ^{
        if (finished && [weakSelf.requestId isEqualToNumber:requestId]) [weakSelf updateNowPlaying];
      });
    }];
  });
  return MPRemoteCommandHandlerStatusSuccess;
}

RCT_EXPORT_METHOD(setMetadata:(NSDictionary *)metadata requestId:(NSNumber *)requestId)
{
  if (![self.requestId isEqualToNumber:requestId] || !self.player) return;
  [self.artworkSession invalidateAndCancel];
  self.artworkSession = nil;
  self.artwork = nil;
  self.metadata = @{
    @"title": [metadata[@"title"] isKindOfClass:NSString.class] ? metadata[@"title"] : @"Untitled track",
    @"artist": [metadata[@"artist"] isKindOfClass:NSString.class] ? metadata[@"artist"] : @"",
    @"queueCount": [metadata[@"queueCount"] isKindOfClass:NSNumber.class] ? metadata[@"queueCount"] : @1,
    @"queueIndex": [metadata[@"queueIndex"] isKindOfClass:NSNumber.class] ? metadata[@"queueIndex"] : @0
  };
  [self registerRemoteCommands];
  [self updateNowPlaying];

  NSString *address = [metadata[@"artworkURI"] isKindOfClass:NSString.class] ? metadata[@"artworkURI"] : nil;
  NSURL *url = address.length ? [NSURL URLWithString:address] : nil;
  if (![url.scheme isEqualToString:@"https"] || !url.host.length || url.user || url.password) return;
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  request.timeoutInterval = 15;
  request.HTTPShouldHandleCookies = NO;
  NSString *authorization = metadata[@"artworkAuthorization"];
  if ([url.host isEqualToString:@"healearth.club"] &&
      (!url.port || url.port.integerValue == 443) &&
      [url.path isEqualToString:@"/ohai/auth/native/music/artwork"] &&
      [authorization isKindOfClass:NSString.class] &&
      [authorization hasPrefix:@"Bearer "]) {
    [request setValue:authorization forHTTPHeaderField:@"Authorization"];
  }
  NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
  configuration.HTTPCookieStorage = nil;
  configuration.URLCache = nil;
  NSURLSession *session = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:nil];
  self.artworkSession = session;
  __weak OhaiMusicPlayer *weakSelf = self;
  [[session dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
    [session finishTasksAndInvalidate];
    if (error || [(NSHTTPURLResponse *)response statusCode] != 200 || data.length > 8 * 1024 * 1024) return;
    UIImage *image = [UIImage imageWithData:data];
    if (!image) return;
    dispatch_async(dispatch_get_main_queue(), ^{
      OhaiMusicPlayer *strongSelf = weakSelf;
      if (![strongSelf.requestId isEqualToNumber:requestId] || strongSelf.artworkSession != session) return;
      strongSelf.artworkSession = nil;
      strongSelf.artwork = [[MPMediaItemArtwork alloc] initWithBoundsSize:image.size
        requestHandler:^UIImage *(CGSize size) { return image; }];
      [strongSelf updateNowPlaying];
    });
  }] resume];
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task
 willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest *))completionHandler
{
  NSURL *url = request.URL;
  // Account artwork never redirects credentials to another resource.
  BOOL authenticated = [task.originalRequest valueForHTTPHeaderField:@"Authorization"].length > 0;
  BOOL allowed = !authenticated && [url.scheme isEqualToString:@"https"] &&
                 url.host.length && !url.user && !url.password;
  completionHandler(allowed ? request : nil);
}

RCT_EXPORT_METHOD(setPaused:(BOOL)paused requestId:(NSNumber *)requestId)
{
  if (![self.requestId isEqualToNumber:requestId]) return;
  if (paused) {
    [self.player pause];
  } else {
    // Another player (including Scripture) may have deactivated the session.
    // Explicit Play must reacquire it before resuming the existing item.
    NSError *error = nil;
    if (![self activateMusicAudioSession:&error]) {
      if (self.hasListeners) [self sendEventWithName:@"OhaiMusicState"
        body:@{ @"requestId": requestId, @"state": @"failed" }];
      return;
    }
    if (self.ended) {
      self.ended = NO;
      [self.player seekToTime:kCMTimeZero];
    }
    [self.player play];
  }
  [self emitState];
}

RCT_EXPORT_METHOD(snapshot:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  double position = CMTimeGetSeconds(self.player.currentTime);
  double duration = CMTimeGetSeconds(self.player.currentItem.duration);
  resolve(@{ @"requestId": self.requestId ?: @0,
             @"position": @(isfinite(position) ? MAX(0, position) : 0),
             @"duration": @(isfinite(duration) ? MAX(0, duration) : 0),
             @"ready": @(self.player && self.player.currentItem.status == AVPlayerItemStatusReadyToPlay),
             @"paused": @(self.player.rate == 0) });
}

RCT_EXPORT_METHOD(seek:(double)position requestId:(NSNumber *)requestId
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  if (!self.player || ![self.requestId isEqualToNumber:requestId] || !isfinite(position) || position < 0) {
    reject(@"playback_changed", @"The local player changed.", nil); return;
  }
  double duration = CMTimeGetSeconds(self.player.currentItem.duration);
  if (isfinite(duration) && duration > 0) position = MIN(position, duration);
  __weak OhaiMusicPlayer *weakSelf = self;
  [self.player seekToTime:CMTimeMakeWithSeconds(position, 600)
         toleranceBefore:kCMTimeZero toleranceAfter:kCMTimeZero completionHandler:^(BOOL finished) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (finished && [weakSelf.requestId isEqualToNumber:requestId]) resolve(nil);
      else reject(@"playback_changed", @"The local player changed.", nil);
    });
  }];
}

RCT_EXPORT_METHOD(releaseForRemote)
{
  [self clearPlayer];
  [AVAudioSession.sharedInstance setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation error:nil];
}

RCT_EXPORT_METHOD(stop)
{
  [self clearPlayer];
}

@end
