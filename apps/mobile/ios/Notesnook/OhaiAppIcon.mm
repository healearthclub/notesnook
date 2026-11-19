#import <UIKit/UIKit.h>
#import <React/RCTBridgeModule.h>

@interface OhaiAppIcon : NSObject <RCTBridgeModule>
@property (nonatomic) BOOL changing;
@end

@implementation OhaiAppIcon
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

- (NSDictionary *)status
{
  UIApplication *app = UIApplication.sharedApplication;
  return @{@"supported": @(app.supportsAlternateIcons), @"name": app.alternateIconName ?: NSNull.null};
}

RCT_EXPORT_METHOD(getStatus:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve([self status]);
}

RCT_EXPORT_METHOD(setIcon:(NSString *)choice resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  NSDictionary *names = @{@"black": @"OhaiIconBlack", @"cream": @"OhaiIconCream", @"purple": @"OhaiIconPurple"};
  if (![choice isKindOfClass:NSString.class] || (!names[choice] && ![choice isEqualToString:@"original"])) {
    reject(@"invalid_icon", @"Choose one of the available app icons.", nil);
    return;
  }
  UIApplication *app = UIApplication.sharedApplication;
  if (!app.supportsAlternateIcons) {
    reject(@"icons_unavailable", @"Changing app icons is unavailable on this device.", nil);
    return;
  }
  if (app.applicationState != UIApplicationStateActive || self.changing) {
    reject(@"icon_change_busy", @"Try again when the app is active.", nil);
    return;
  }
  NSString *name = names[choice];
  if (app.alternateIconName == name || [app.alternateIconName isEqualToString:name]) {
    resolve([self status]);
    return;
  }
  self.changing = YES;
  // Use the public iOS API and its normal system confirmation.
  [app setAlternateIconName:name completionHandler:^(NSError *error) {
    dispatch_async(dispatch_get_main_queue(), ^{
      self.changing = NO;
      if (error) {
        NSLog(@"0hi icon change failed (%@:%ld)", error.domain, (long)error.code);
        reject(@"icon_change_failed", @"Could not change the app icon. Please try again.", error);
      }
      else resolve([self status]);
    });
  }];
}
@end
