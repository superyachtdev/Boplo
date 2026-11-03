import Foundation
import Capacitor

@objc public class SplashScreen: NSObject {

    var parentView: UIView
    var viewController = UIViewController()
    var spinner = UIActivityIndicatorView()
    var config: SplashScreenConfig = SplashScreenConfig()
    var hideTask: DispatchWorkItem?
    var isVisible: Bool = false
    var hideRequested: Bool = false

    init(parentView: UIView, config: SplashScreenConfig) {
        self.parentView = parentView
        self.config = config
    }

    public func showOnLaunch() {
        buildViews()
        if self.config.launchShowDuration == 0 {
            return
        }
        var settings = SplashScreenSettings()
        settings.showDuration = config.launchShowDuration
        settings.fadeInDuration = config.launchFadeInDuration
        settings.autoHide = config.launchAutoHide
        showSplash(settings: settings, completion: {}, isLaunchSplash: true)
    }

    public func show(settings: SplashScreenSettings, completion: @escaping () -> Void) {
        self.showSplash(settings: settings, completion: completion, isLaunchSplash: false)
    }

    public func hide(settings: SplashScreenSettings) {
        hideSplash(fadeOutDuration: settings.fadeOutDuration, isLaunchSplash: false)
    }

    private func showSplash(settings: SplashScreenSettings, completion: @escaping () -> Void, isLaunchSplash: Bool) {
        DispatchQueue.main.async { [weak self] in
            guard let strongSelf = self else {
                return
            }
            if let backgroundColor = strongSelf.config.backgroundColor {
                strongSelf.viewController.view.backgroundColor = backgroundColor
            }

            if strongSelf.config.showSpinner {
                if let style = strongSelf.config.spinnerStyle {
                    strongSelf.spinner.style = style
                }

                if let spinnerColor = strongSelf.config.spinnerColor {
                    strongSelf.spinner.color = spinnerColor
                }
            }

            strongSelf.parentView.addSubview(strongSelf.viewController.view)

            if strongSelf.config.showSpinner {
                strongSelf.parentView.addSubview(strongSelf.spinner)
                strongSelf.spinner.centerXAnchor.constraint(equalTo: strongSelf.parentView.centerXAnchor).isActive = true
                strongSelf.spinner.centerYAnchor.constraint(equalTo: strongSelf.parentView.centerYAnchor).isActive = true
            }

            strongSelf.parentView.isUserInteractionEnabled = false

            UIView.transition(with: strongSelf.viewController.view, duration: TimeInterval(Double(settings.fadeInDuration) / 1000), options: .curveLinear, animations: {
                strongSelf.viewController.view.alpha = 1

                if strongSelf.config.showSpinner {
                    strongSelf.spinner.alpha = 1
                }
            }) { (_: Bool) in
                strongSelf.isVisible = true
                // A hide() that arrived during fade-in used to be ignored, leaving touches disabled.
                if strongSelf.hideRequested {
                    strongSelf.hideRequested = false
                    strongSelf.hideSplash(fadeOutDuration: settings.fadeOutDuration, isLaunchSplash: false)
                    completion()
                    return
                }

                if settings.autoHide {
                    let work = DispatchWorkItem {
                        strongSelf.hideSplash(fadeOutDuration: settings.fadeOutDuration, isLaunchSplash: isLaunchSplash)
                        completion()
                    }
                    strongSelf.hideTask = work
                    DispatchQueue.main.asyncAfter(
                        deadline: DispatchTime.now() + (Double(settings.showDuration) / 1000),
                        execute: work
                    )
                } else {
                    completion()
                }
            }
        }
    }

    private func buildViews() {
        let storyboardName = Bundle.main.infoDictionary?["UILaunchStoryboardName"] as? String ?? "LaunchScreen"
        if let vc = UIStoryboard(name: storyboardName.replacingOccurrences(of: ".storyboard", with: ""), bundle: nil).instantiateInitialViewController() {
            viewController = vc
        }

        // Observe for changes on frame and bounds to handle rotation resizing
        parentView.addObserver(self, forKeyPath: "frame", options: .new, context: nil)
        parentView.addObserver(self, forKeyPath: "bounds", options: .new, context: nil)

        updateSplashImageBounds()
        if config.showSpinner {
            spinner.translatesAutoresizingMaskIntoConstraints = false
            spinner.startAnimating()
        }
    }

    private func tearDown() {
        isVisible = false
        parentView.isUserInteractionEnabled = true
        viewController.view.removeFromSuperview()

        if config.showSpinner {
            spinner.removeFromSuperview()
        }
    }

    // Update the bounds for the splash image. This will also be called when
    // the parent view observers fire
    private func updateSplashImageBounds() {
        var window: UIWindow? = UIApplication.shared.delegate?.window ?? nil

        if window == nil {
            let scene: UIWindowScene? = UIApplication.shared.connectedScenes.first as? UIWindowScene
            window = scene?.windows.filter({$0.isKeyWindow}).first
            if window == nil {
                window = scene?.windows.first
            }
        }

        if let unwrappedWindow = window {
            viewController.view.frame = CGRect(origin: CGPoint(x: 0, y: 0), size: unwrappedWindow.bounds.size)
        } else {
            CAPLog.print("Unable to find root window object for SplashScreen bounds. Please file an issue")
        }
    }

    override public func observeValue(forKeyPath keyPath: String?, of object: Any?, change _: [NSKeyValueChangeKey: Any]?, context: UnsafeMutableRawPointer?) {
        updateSplashImageBounds()
    }

    private func hideSplash(fadeOutDuration: Int, isLaunchSplash: Bool) {
        if isLaunchSplash, isVisible {
            CAPLog.print("SplashScreen.hideSplash: SplashScreen was automatically hidden after default timeout. " +
                            "You should call `SplashScreen.hide()` as soon as your web app is loaded (or increase the timeout). " +
                            "Read more at https://capacitorjs.com/docs/apis/splash-screen#hiding-the-splash-screen")
        }
        // hide() before the fade-in completion used to return and leave the web view untappable.
        if !isVisible {
            hideRequested = true
            parentView.isUserInteractionEnabled = true
            viewController.view.isUserInteractionEnabled = false
            return
        }
        hideTask?.cancel()
        hideTask = nil
        // Re-enable touches now. The fade completion is skipped when a layout pass rewrites the
        // splash frame (the bounds observer does that while the remote page loads), and waiting
        // for it left the flight desk visible and dead.
        parentView.isUserInteractionEnabled = true
        viewController.view.isUserInteractionEnabled = false
        DispatchQueue.main.async {
            UIView.transition(with: self.viewController.view, duration: TimeInterval(Double(fadeOutDuration) / 1000), options: .curveLinear, animations: {
                self.viewController.view.alpha = 0

                if self.config.showSpinner {
                    self.spinner.alpha = 0
                }
            }) { (_: Bool) in
                self.tearDown()
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + (Double(fadeOutDuration) / 1000) + 0.35) { [weak self] in
                guard let self = self, self.viewController.view.superview != nil else { return }
                self.tearDown()
            }
        }
    }
}
