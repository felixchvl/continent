//
//  LoginView.swift
//  Continent
//
//  Created by Félix Chevalier on 27/01/2024.
//

import SwiftUI
import MapKit

struct LoginView: View {
    @StateObject var viewModel = LoginViewViewModel()
    @State private var profileMainOffset: CGFloat = 0 // Décalage vertical initial de ProfileMain
    @State private var isProfileMainVisible = false // Indique si ProfileMain est visible
    
    @State private var region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194),
        span: MKCoordinateSpan(latitudeDelta: 10, longitudeDelta: 10)
    )
    
    var body: some View {
        NavigationView {
            ZStack {
                Map()
                    .mapStyle(.hybrid(elevation: .realistic))
                
                if isProfileMainVisible {
                    ProfileMain()
                        .offset(y: -profileMainOffset) // Appliquer le décalage vertical vers le haut
                        .gesture(
                            DragGesture()
                                .onChanged { value in
                                    // Détection du glissement
                                    let newOffset = value.translation.height
                                    if newOffset < 0 {
                                        profileMainOffset = -newOffset
                                    }
                                }
                                .onEnded { value in
                                    // Fin du glissement
                                    let screenHeight = UIScreen.main.bounds.height
                                    withAnimation {
                                        if profileMainOffset > screenHeight / 2 {
                                            profileMainOffset = 0
                                            isProfileMainVisible = false
                                        } else {
                                            profileMainOffset = 0
                                        }
                                    }
                                }
                        )
                        .transition(.move(edge: .top)) // Animation de déplacement vers le haut
                }
            }
        }
        .onAppear {
            // Afficher ProfileMain lorsque la vue apparaît
            isProfileMainVisible = true
        }
    }
}

// Commande de preview sur l'iPhone
struct LoginView_Previews: PreviewProvider {
    static var previews: some View {
        LoginView()
    }
}
 
