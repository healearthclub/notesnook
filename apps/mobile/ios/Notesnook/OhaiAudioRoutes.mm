#import <AVFoundation/AVFoundation.h>
#import <AVKit/AVKit.h>
#import <UIKit/UIKit.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTViewManager.h>

// Route selection belongs to iOS: do not scan Bluetooth, enumerate paired
// accessories, or force speaker overrides on the shared playback session.
@interface OhaiAudioRoutes : RCTEventEmitter <RCTBridgeModule>
@property (nonatomic) BOOL listening;
@end

@implementation OhaiAudioRoutes
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"OhaiAudioOutputChanged"]; }

- (NSDictionary *)outputSnapshot
{
  NSMutableArray *outputs = [NSMutableArray new];
  for (AVAudioSessionPortDescription *port in AVAudioSession.sharedInstance.currentRoute.outputs) {
    NSString *kind = @"wired";
    if ([port.portType isEqualToString:AVAudioSessionPortBuiltInSpeaker] ||
        [port.portType isEqualToString:AVAudioSessionPortBuiltInReceiver]) kind = @"iphone";
    else if ([port.portType isEqualToString:AVAudioSessionPortBluetoothA2DP] ||
             [port.portType isEqualToString:AVAudioSessionPortBluetoothLE] ||
             [port.portType isEqualToString:AVAudioSessionPortBluetoothHFP]) kind = @"bluetooth";
    else if ([port.portType isEqualToString:AVAudioSessionPortAirPlay]) kind = @"airplay";
    [outputs addObject:@{@"id": port.UID ?: port.portType,
      @"name": [kind isEqualToString:@"iphone"] ? @"This iPhone" : port.portName,
      @"kind": kind}];
  }
  // No route is reported before the first audio session is established.
  // Keep that state explicit rather than inventing a connected device.
  return @{@"outputs": outputs};
}

RCT_EXPORT_METHOD(currentOutput:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve([self outputSnapshot]);
}
- (void)startObserving
{
  self.listening = YES;
  [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(outputChanged:) name:AVAudioSessionRouteChangeNotification object:nil];
  [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(outputChanged:) name:UIApplicationDidBecomeActiveNotification object:nil];
}
- (void)stopObserving
{
  self.listening = NO;
  [NSNotificationCenter.defaultCenter removeObserver:self];
}
- (void)outputChanged:(NSNotification *)notification
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.listening) [self sendEventWithName:@"OhaiAudioOutputChanged" body:[self outputSnapshot]];
  });
}
- (void)invalidate
{
  [self stopObserving];
  [super invalidate];
}
@end

@interface OhaiAudioRoutePicker : RCTViewManager
@end
@implementation OhaiAudioRoutePicker
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup { return YES; }
- (UIView *)view
{
  AVRoutePickerView *picker = [AVRoutePickerView new];
  picker.prioritizesVideoDevices = NO;
  picker.accessibilityLabel = @"Choose Bluetooth or AirPlay output";
  return picker;
}
RCT_EXPORT_VIEW_PROPERTY(tintColor, UIColor)
RCT_EXPORT_VIEW_PROPERTY(activeTintColor, UIColor)
RCT_EXPORT_VIEW_PROPERTY(prioritizesVideoDevices, BOOL)
@end
