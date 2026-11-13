#import "AppDelegate.h"
#import <React/RCTBundleURLProvider.h>
#import <React/RCTLinkingManager.h>
#import "RNShortcuts.h"
#import "RNBootSplash.h"
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>
#import "RNFileUploader.h"
#import <AuthenticationServices/AuthenticationServices.h>
#import <CommonCrypto/CommonDigest.h>
#import <React/RCTBridgeModule.h>
#import <Security/Security.h>

static NSString *const OhaiAuthHost = @"healearth.club";
static NSString *const OhaiAuthCallback = @"/ohai/auth/native/complete";

static NSString *OhaiBase64URL(NSData *data)
{
  NSString *base64 = [data base64EncodedStringWithOptions:0];
  base64 = [base64 stringByReplacingOccurrencesOfString:@"+" withString:@"-"];
  base64 = [base64 stringByReplacingOccurrencesOfString:@"/" withString:@"_"];
  return [base64 stringByReplacingOccurrencesOfString:@"=" withString:@""];
}

@interface OhaiGoogleAuth : NSObject <RCTBridgeModule, ASWebAuthenticationPresentationContextProviding>
@property (nonatomic, strong) ASWebAuthenticationSession *session;
@end

@implementation OhaiGoogleAuth

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup { return NO; }

- (ASPresentationAnchor)presentationAnchorForWebAuthenticationSession:(ASWebAuthenticationSession *)session
{
  AppDelegate *delegate = (AppDelegate *)UIApplication.sharedApplication.delegate;
  return delegate.window;
}

RCT_EXPORT_METHOD(openGoogleSignIn:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.session) {
      reject(@"auth_in_progress", @"Google sign-in is already open.", nil);
      return;
    }
    if (@available(iOS 17.4, *)) {
      uint8_t bytes[32];
      if (SecRandomCopyBytes(kSecRandomDefault, sizeof(bytes), bytes) != errSecSuccess) {
        reject(@"auth_failed", @"Could not start Google sign-in.", nil);
        return;
      }
      NSString *verifier = OhaiBase64URL([NSData dataWithBytes:bytes length:sizeof(bytes)]);
      NSData *verifierData = [verifier dataUsingEncoding:NSUTF8StringEncoding];
      unsigned char digest[CC_SHA256_DIGEST_LENGTH];
      CC_SHA256(verifierData.bytes, (CC_LONG)verifierData.length, digest);
      NSString *challenge = OhaiBase64URL([NSData dataWithBytes:digest length:sizeof(digest)]);

      NSURLComponents *start = [NSURLComponents new];
      start.scheme = @"https";
      start.host = OhaiAuthHost;
      start.path = @"/ohai/auth/google/start";
      start.queryItems = @[[NSURLQueryItem queryItemWithName:@"native_challenge" value:challenge]];
      ASWebAuthenticationSessionCallback *callback =
        [ASWebAuthenticationSessionCallback callbackWithHTTPSHost:OhaiAuthHost path:OhaiAuthCallback];

      self.session = [[ASWebAuthenticationSession alloc] initWithURL:start.URL callback:callback
        completionHandler:^(NSURL *url, NSError *error) {
          dispatch_async(dispatch_get_main_queue(), ^{
            self.session = nil;
            if ([error.domain isEqualToString:ASWebAuthenticationSessionErrorDomain] &&
                error.code == ASWebAuthenticationSessionErrorCodeCanceledLogin) {
              resolve(nil);
              return;
            }
            NSURLComponents *result = url ? [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO] : nil;
            if (error || ![result.scheme isEqualToString:@"https"] ||
                ![result.host isEqualToString:OhaiAuthHost] || ![result.path isEqualToString:OhaiAuthCallback]) {
              reject(@"auth_failed", @"Google sign-in could not be completed.", nil);
              return;
            }
            for (NSURLQueryItem *item in result.queryItems) {
              if ([item.name isEqualToString:@"error"]) {
                if ([item.value isEqualToString:@"cancelled"]) resolve(nil);
                else reject([item.value isEqualToString:@"not_allowed"] ? @"not_allowed" : @"auth_failed",
                            @"Google sign-in could not be completed.", nil);
                return;
              }
              if ([item.name isEqualToString:@"code"] && item.value.length == 43) {
                resolve(@{@"code": item.value, @"verifier": verifier});
                return;
              }
            }
            reject(@"auth_failed", @"Google sign-in could not be completed.", nil);
          });
        }];
      self.session.presentationContextProvider = self;
      if (![self.session start]) {
        self.session = nil;
        reject(@"auth_failed", @"Could not start Google sign-in.", nil);
      }
    } else {
      reject(@"os_unsupported", @"Google sign-in requires iOS 17.4 or later.", nil);
    }
  });
}

@end


@interface ReactNativeDelegate : RCTDefaultReactNativeFactoryDelegate
@end

@implementation ReactNativeDelegate

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end

@interface AppDelegate ()
@property (nonatomic, strong) ReactNativeDelegate *reactNativeDelegate;
@end

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.dependencyProvider = [RCTAppDependencyProvider new];
  ReactNativeDelegate *delegate = [ReactNativeDelegate new];
  RCTReactNativeFactory *factory = [[RCTReactNativeFactory alloc] initWithDelegate:delegate];
  delegate.dependencyProvider = [RCTAppDependencyProvider new];
  self.reactNativeDelegate = delegate;
  
  self.reactNativeFactory = factory;
  self.window = [[UIWindow alloc] initWithFrame:[UIScreen mainScreen].bounds];
  [factory startReactNativeWithModuleName: @"Notesnook"
                                      inWindow:self.window
                           launchOptions:launchOptions];

  [self.window makeKeyAndVisible];
  return YES;
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}
 
- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

- (void)application:(UIApplication *)application performActionForShortcutItem:(UIApplicationShortcutItem *)shortcutItem completionHandler:(void (^)(BOOL))completionHandler {
  [RNShortcuts performActionForShortcutItem:shortcutItem completionHandler:completionHandler];
}

- (BOOL)application:(UIApplication *)application
            openURL:(NSURL *)url
            options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options
{
  return [RCTLinkingManager application:application openURL:url options:options];
}

- (void)customizeRootView:(RCTRootView *)rootView {
  [RNBootSplash initWithStoryboard:@"BootSplash" rootView:rootView]; // ⬅️ initialize the splash screen
}

- (void)application:(UIApplication *)application handleEventsForBackgroundURLSession:(NSString *)identifier completionHandler:(void (^)())completionHandler {
  [RNFileUploader setCompletionHandlerWithIdentifier:identifier completionHandler:completionHandler];
}

@end
