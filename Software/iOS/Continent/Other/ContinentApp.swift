//
//  ContinentApp.swift
//  Continent
//
//  Created by Félix Chevalier on 27/01/2024.
//

import SwiftUI
import FirebaseCore


@main
struct ContinentApp: App {
    
    init() {
        FirebaseApp.configure()
        print("Ca marche!")
    }
    
    var body: some Scene {
        WindowGroup {
            MainView()
        }
    }
}


